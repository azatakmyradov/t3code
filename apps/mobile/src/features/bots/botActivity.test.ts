import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";
import { createBotActivityAtom } from "./botActivity";

const main = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("main"));
const task = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("task"));
function working(ref: ScopedThreadRef) {
  const shell = makeThreadShellFixture({ environmentId: ref.environmentId, id: ref.threadId });
  return {
    ...shell,
    runtime: {
      status: "running" as const,
      activeRunId: null,
      providerInstanceId: shell.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: shell.updatedAt,
    },
  };
}
function harness() {
  const registry = AtomRegistry.make();
  const shells = Atom.family((_key: string) => Atom.make<EnvironmentThreadShell | null>(null));
  const shellAtom = (ref: ScopedThreadRef) => shells(scopedThreadKey(ref));
  const activity = createBotActivityAtom([main, task], shellAtom);
  registry.mount(activity);
  return {
    registry,
    set: (ref: ScopedThreadRef, shell: EnvironmentThreadShell | null) =>
      registry.set(shellAtom(ref), shell),
    status: () => registry.get(activity),
  };
}
describe("bot activity on Home", () => {
  it("tracks main and remote tasks and clears when both stop", () => {
    const h = harness();
    try {
      expect(h.status()).toBe("Ready");
      h.set(main, working(main));
      expect(h.status()).toBe("Working");
      h.set(task, working(task));
      h.set(main, makeThreadShellFixture());
      expect(h.status()).toBe("Working");
      h.set(task, null);
      expect(h.status()).toBe("Ready");
    } finally {
      h.registry.dispose();
    }
  });
  it("prioritizes approval and input over ongoing work", () => {
    const h = harness();
    try {
      h.set(task, working(task));
      h.set(main, makeThreadShellFixture({ hasPendingUserInput: true }));
      expect(h.status()).toBe("Awaiting input");
      h.set(main, makeThreadShellFixture({ hasPendingApprovals: true }));
      expect(h.status()).toBe("Approval needed");
      h.set(main, null);
      expect(h.status()).toBe("Working");
    } finally {
      h.registry.dispose();
    }
  });
  it("ignores archived work and unrelated environments with matching IDs", () => {
    const h = harness();
    try {
      h.set(task, { ...working(task), archivedAt: "2026-10-09T00:00:00Z" });
      h.set(scopeThreadRef(main.environmentId, task.threadId), working(task));
      expect(h.status()).toBe("Ready");
    } finally {
      h.registry.dispose();
    }
  });
});

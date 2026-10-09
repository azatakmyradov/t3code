import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, RunId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadFixture } from "../../test-fixtures";
import { createBotActivityAtom } from "./botActivity";

const main = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("main"));
const task = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("task"));

function working(ref: ScopedThreadRef) {
  const idle = makeThreadFixture({ environmentId: ref.environmentId, id: ref.threadId });
  return {
    ...idle,
    runtime: {
      status: "running" as const,
      activeRunId: null,
      providerInstanceId: idle.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: idle.updatedAt,
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

describe("bot activity", () => {
  it("shows connecting while a task is queued or starting", () => {
    const h = harness();
    try {
      const thread = working(task);
      for (const status of ["queued", "preparing", "starting"] as const) {
        h.set(task, { ...thread, runtime: { ...thread.runtime, status } });
        expect(h.status()?.label).toBe("Connecting");
      }
    } finally {
      h.registry.dispose();
    }
  });

  it("does not leave a working indicator after a task completes", () => {
    const h = harness();
    try {
      h.set(task, working(task));
      h.set(
        task,
        makeThreadFixture({
          latestRun: {
            runId: RunId.make("completed-run"),
            status: "completed",
            requestedAt: "2026-10-09T00:00:00Z",
            startedAt: "2026-10-09T00:00:00Z",
            completedAt: "2026-10-09T00:01:00Z",
            assistantMessageId: null,
          },
        }),
      );
      expect(h.status()).toBeNull();
    } finally {
      h.registry.dispose();
    }
  });

  it("updates when main or remote task work starts and stops", () => {
    const h = harness();
    try {
      expect(h.status()).toBeNull();
      h.set(main, working(main));
      expect(h.status()?.label).toBe("Working");
      h.set(task, working(task));
      h.set(main, makeThreadFixture());
      expect(h.status()?.label).toBe("Working");
      h.set(task, null);
      expect(h.status()).toBeNull();
    } finally {
      h.registry.dispose();
    }
  });

  it("prioritizes approval and input requests over working tasks", () => {
    const h = harness();
    try {
      h.set(task, working(task));
      h.set(main, makeThreadFixture({ hasPendingUserInput: true }));
      expect(h.status()?.label).toBe("Awaiting Input");
      h.set(main, makeThreadFixture({ hasPendingUserInput: true, hasPendingApprovals: true }));
      expect(h.status()?.label).toBe("Pending Approval");
      h.set(main, null);
      expect(h.status()?.label).toBe("Working");
    } finally {
      h.registry.dispose();
    }
  });

  it("ignores archived threads and unrelated environments with the same thread ID", () => {
    const h = harness();
    try {
      h.set(task, { ...working(task), archivedAt: "2026-10-09T00:00:00Z" });
      h.set(scopeThreadRef(main.environmentId, task.threadId), working(task));
      expect(h.status()).toBeNull();
    } finally {
      h.registry.dispose();
    }
  });

  it("keeps the status value stable during unrelated shell changes", () => {
    const h = harness();
    try {
      h.set(task, working(task));
      const previous = h.status();
      h.set(task, { ...working(task), title: "New title" });
      expect(h.status()).toBe(previous);
    } finally {
      h.registry.dispose();
    }
  });
});

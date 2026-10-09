import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { resolveThreadListV2Status } from "../threads/threadListV2";

/** Only subscribes to the bot's main and task shells, without loading history. */
export function createBotActivityAtom(
  refs: ReadonlyArray<ScopedThreadRef>,
  threadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>,
) {
  return Atom.make((get) => {
    let status = "Ready";
    for (const ref of refs) {
      const shell = get(threadShellAtom(ref));
      if (!shell || shell.archivedAt !== null) continue;
      const next = resolveThreadListV2Status(shell);
      if (next === "approval") return "Approval needed";
      if (next === "input") status = "Awaiting input";
      else if (next === "working" && status !== "Awaiting input") status = "Working";
    }
    return status;
  });
}

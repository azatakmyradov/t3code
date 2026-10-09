import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import {
  resolveProjectStatusIndicator,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

/** Uses the existing shell stream, including task threads on other environments. */
export function createBotActivityAtom(
  refs: ReadonlyArray<ScopedThreadRef>,
  threadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>,
) {
  let previous: ThreadStatusPill | null = null;
  return Atom.make((get) => {
    const status = resolveProjectStatusIndicator(
      refs.map((ref) => {
        const thread = get(threadShellAtom(ref));
        if (thread === null || thread.archivedAt !== null) return null;
        const status = resolveThreadStatusPill({ thread });
        // Idle bots stay quiet, even when an older task has an unseen completion.
        return status?.label === "Completed" ? null : status;
      }),
    );
    if (status?.label === previous?.label) return previous;
    previous = status;
    return status;
  });
}

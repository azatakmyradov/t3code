import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { waitForThreadShell } from "../../state/entities";
import { toastManager } from "../ui/toast";

/** The message to show for a failed bot command, or null when there is nothing to report. */
export function botCommandError(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** Opens a conversation a bot command just created, once its shell has synced. */
export function useOpenBotThread() {
  const navigate = useNavigate();
  return async (environmentId: EnvironmentId, threadId: ThreadId) => {
    if (!(await waitForThreadShell(scopeThreadRef(environmentId, threadId)))) {
      toastManager.add({
        type: "error",
        title: "Conversation isn't available yet",
        description: "It was created. Reconnect, then open it from the sidebar.",
      });
      return;
    }
    await navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
  };
}

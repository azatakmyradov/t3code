/**
 * Store watcher that fires agent notifications on meaningful state transitions.
 *
 * Every transport path (live thread-detail events, shell snapshots, recovered
 * batches) converges in the Zustand store, so a single store subscription that
 * diffs per-thread signatures is the most robust, source-agnostic hook.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { type AppState, selectThreadsAcrossEnvironments, useStore } from "../store";
import {
  computeAgentNotifications,
  type ThreadNotificationSignature,
} from "./agentNotificationTransitions";
import { notifyAgentEvent } from "./agentNotifications";

function signatureForThread(
  thread: ReturnType<typeof selectThreadsAcrossEnvironments>[number],
): ThreadNotificationSignature {
  return {
    turnState: thread.latestTurn?.state ?? null,
    hasPendingApproval: derivePendingApprovals(thread.activities).length > 0,
    hasPendingInput: derivePendingUserInputs(thread.activities).length > 0,
  };
}

/**
 * Starts the watcher. Returns an unsubscribe function. Mount once at app
 * bootstrap.
 */
export function startAgentNotificationWatcher(): () => void {
  const lastSeen = new Map<string, ThreadNotificationSignature>();

  const handleState = (state: AppState): void => {
    const threads = selectThreadsAcrossEnvironments(state);
    const present = new Set<string>();

    for (const thread of threads) {
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const key = scopedThreadKey(threadRef);
      present.add(key);
      const next = signatureForThread(thread);
      const previous = lastSeen.get(key);

      for (const notification of computeAgentNotifications(previous, next, thread.title)) {
        notifyAgentEvent({
          title: notification.title,
          body: notification.body,
          threadRef,
        });
      }

      lastSeen.set(key, next);
    }

    // Prune entries for threads no longer present.
    for (const key of lastSeen.keys()) {
      if (!present.has(key)) {
        lastSeen.delete(key);
      }
    }
  };

  // Seed from the current state without notifying.
  handleState(useStore.getState());

  return useStore.subscribe(handleState);
}

/**
 * Pure transition logic for agent notifications.
 *
 * Kept free of store/DOM/runtime imports so it can be unit-tested in isolation
 * and reused by the store watcher.
 */
import type { OrchestrationLatestTurnState } from "@t3tools/contracts";

export interface ThreadNotificationSignature {
  readonly turnState: OrchestrationLatestTurnState | null;
  readonly hasPendingApproval: boolean;
  readonly hasPendingInput: boolean;
}

export type AgentNotificationKind = "completed" | "error" | "approval" | "input";

export interface AgentNotificationDescriptor {
  readonly kind: AgentNotificationKind;
  readonly title: string;
  readonly body: string;
}

const NOTIFICATION_BODY: Record<AgentNotificationKind, string> = {
  completed: "Agent finished",
  error: "Agent failed",
  approval: "Needs approval",
  input: "Needs your input",
};

/**
 * Maps the previous and next signatures for a thread to the set of
 * notifications that should fire. Returns an empty array when there is no
 * previous signature (first observation is seeded silently so already-finished
 * threads don't fire on page load).
 */
export function computeAgentNotifications(
  previous: ThreadNotificationSignature | undefined,
  next: ThreadNotificationSignature,
  threadTitle: string,
): AgentNotificationDescriptor[] {
  if (!previous) {
    return [];
  }

  const title = threadTitle.trim() || "Agent";
  const descriptors: AgentNotificationDescriptor[] = [];

  if (previous.turnState === "running" && next.turnState === "completed") {
    descriptors.push({ kind: "completed", title, body: NOTIFICATION_BODY.completed });
  } else if (previous.turnState === "running" && next.turnState === "error") {
    descriptors.push({ kind: "error", title, body: NOTIFICATION_BODY.error });
  }

  if (!previous.hasPendingApproval && next.hasPendingApproval) {
    descriptors.push({ kind: "approval", title, body: NOTIFICATION_BODY.approval });
  }

  if (!previous.hasPendingInput && next.hasPendingInput) {
    descriptors.push({ kind: "input", title, body: NOTIFICATION_BODY.input });
  }

  return descriptors;
}

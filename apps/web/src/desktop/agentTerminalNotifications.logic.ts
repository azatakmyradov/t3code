import type { EnvironmentId, OrchestrationLatestTurn, ThreadId, TurnId } from "@t3tools/contracts";

import type { AppState } from "../store";
import type { Project, SidebarThreadSummary } from "../types";

type AgentTerminalTurnState = "completed" | "error";

type TerminalAgentTurn = OrchestrationLatestTurn & {
  readonly state: AgentTerminalTurnState;
  readonly completedAt: string;
};

export interface AgentTerminalNotificationKeyInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly state: AgentTerminalTurnState;
  readonly completedAt: string;
}

export interface AgentTerminalNotificationCandidate extends AgentTerminalNotificationKeyInput {
  readonly key: string;
  readonly thread: SidebarThreadSummary;
  readonly project: Project | undefined;
}

export interface AgentTerminalNotificationView {
  readonly title: string;
  readonly body: string;
}

export function isTerminalAgentTurn(
  latestTurn: OrchestrationLatestTurn | null | undefined,
): latestTurn is TerminalAgentTurn {
  return (
    latestTurn !== null &&
    latestTurn !== undefined &&
    latestTurn.completedAt !== null &&
    (latestTurn.state === "completed" || latestTurn.state === "error")
  );
}

export function notificationKey(input: AgentTerminalNotificationKeyInput): string {
  return JSON.stringify([
    input.environmentId,
    input.threadId,
    input.turnId,
    input.state,
    input.completedAt,
  ]);
}

export function collectAgentTerminalNotificationCandidates(
  previousState: AppState | null | undefined,
  nextState: AppState,
): AgentTerminalNotificationCandidate[] {
  if (!previousState) {
    return [];
  }

  const candidates: AgentTerminalNotificationCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const [environmentId, environmentState] of Object.entries(nextState.environmentStateById)) {
    const previousEnvironmentState = previousState.environmentStateById[environmentId];
    for (const thread of Object.values(environmentState.sidebarThreadSummaryById)) {
      const latestTurn = thread.latestTurn;
      if (!isTerminalAgentTurn(latestTurn)) {
        continue;
      }

      const key = notificationKey({
        environmentId: thread.environmentId,
        threadId: thread.id,
        turnId: latestTurn.turnId,
        state: latestTurn.state,
        completedAt: latestTurn.completedAt,
      });
      if (seenKeys.has(key)) {
        continue;
      }

      const previousLatestTurn =
        previousEnvironmentState?.sidebarThreadSummaryById[thread.id]?.latestTurn;
      const previousKey = isTerminalAgentTurn(previousLatestTurn)
        ? notificationKey({
            environmentId: thread.environmentId,
            threadId: thread.id,
            turnId: previousLatestTurn.turnId,
            state: previousLatestTurn.state,
            completedAt: previousLatestTurn.completedAt,
          })
        : null;
      if (previousKey === key) {
        continue;
      }

      seenKeys.add(key);
      candidates.push({
        key,
        environmentId: thread.environmentId,
        threadId: thread.id,
        turnId: latestTurn.turnId,
        state: latestTurn.state,
        completedAt: latestTurn.completedAt,
        thread,
        project: environmentState.projectById[thread.projectId],
      });
    }
  }

  return candidates;
}

export function formatAgentTerminalNotification(
  input: Pick<AgentTerminalNotificationCandidate, "project" | "state" | "thread">,
): AgentTerminalNotificationView {
  const projectName = input.project?.name.trim() || "this project";
  return {
    title: input.thread.title,
    body:
      input.state === "completed"
        ? `Agent finished in ${projectName}`
        : `Agent failed in ${projectName}`,
  };
}

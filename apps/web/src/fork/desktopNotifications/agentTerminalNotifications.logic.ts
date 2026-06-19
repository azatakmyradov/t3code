import type { EnvironmentId, OrchestrationLatestTurn, ThreadId, TurnId } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";

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
  readonly thread: EnvironmentThreadShell;
  readonly project: EnvironmentProject | undefined;
}

export interface AgentTerminalNotificationView {
  readonly title: string;
  readonly body: string;
}

export interface AgentTerminalNotificationState {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
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
  previousState: AgentTerminalNotificationState | null | undefined,
  nextState: AgentTerminalNotificationState,
): AgentTerminalNotificationCandidate[] {
  if (!previousState) {
    return [];
  }

  const candidates: AgentTerminalNotificationCandidate[] = [];
  const seenKeys = new Set<string>();
  const previousThreadByEnvironmentAndId = new Map(
    previousState.threads.map(
      (thread) => [`${thread.environmentId}:${thread.id}`, thread] as const,
    ),
  );
  const projectByEnvironmentAndId = new Map(
    nextState.projects.map(
      (project) => [`${project.environmentId}:${project.id}`, project] as const,
    ),
  );

  for (const thread of nextState.threads) {
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

    const previousLatestTurn = previousThreadByEnvironmentAndId.get(
      `${thread.environmentId}:${thread.id}`,
    )?.latestTurn;
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
      project: projectByEnvironmentAndId.get(`${thread.environmentId}:${thread.projectId}`),
    });
  }

  return candidates;
}

export function formatAgentTerminalNotification(
  input: Pick<AgentTerminalNotificationCandidate, "project" | "state" | "thread">,
): AgentTerminalNotificationView {
  const projectName = input.project?.title.trim() || "this project";
  return {
    title: input.thread.title,
    body:
      input.state === "completed"
        ? `Agent finished in ${projectName}`
        : `Agent failed in ${projectName}`,
  };
}

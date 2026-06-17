import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationLatestTurn,
} from "@t3tools/contracts";

import type { AppState, EnvironmentState } from "../store";
import type { Project, SidebarThreadSummary } from "../types";
import {
  collectAgentTerminalNotificationCandidates,
  formatAgentTerminalNotification,
  isTerminalAgentTurn,
} from "./agentTerminalNotifications.logic";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const ISO_REQUESTED = "2026-06-16T12:00:00.000Z";
const ISO_STARTED = "2026-06-16T12:00:01.000Z";
const ISO_COMPLETED = "2026-06-16T12:00:10.000Z";

function turn(input: {
  readonly state: OrchestrationLatestTurn["state"];
  readonly turnId?: string;
  readonly completedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: TurnId.make(input.turnId ?? "turn-1"),
    state: input.state,
    requestedAt: ISO_REQUESTED,
    startedAt: ISO_STARTED,
    completedAt: input.completedAt ?? null,
    assistantMessageId: null,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    name: "T3 Code",
    cwd: "/repo/t3code",
    defaultModelSelection: null,
    scripts: [],
    ...overrides,
  };
}

function threadSummary(
  latestTurn: OrchestrationLatestTurn | null,
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
  return {
    id: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Fix notifications",
    interactionMode: "default",
    session: null,
    createdAt: ISO_REQUESTED,
    archivedAt: null,
    updatedAt: ISO_COMPLETED,
    latestTurn,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function environmentState(input: {
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly projects?: ReadonlyArray<Project>;
}): EnvironmentState {
  const projects = input.projects ?? [project()];
  return {
    projectIds: projects.map((entry) => entry.id),
    projectById: Object.fromEntries(projects.map((entry) => [entry.id, entry])),
    threadIds: input.threads.map((entry) => entry.id),
    threadIdsByProjectId: {
      [PROJECT_ID]: input.threads.map((entry) => entry.id),
    },
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    sidebarThreadSummaryById: Object.fromEntries(input.threads.map((entry) => [entry.id, entry])),
    bootstrapComplete: true,
  };
}

function appState(environment: EnvironmentState): AppState {
  return {
    activeEnvironmentId: ENVIRONMENT_ID,
    environmentStateById: {
      [ENVIRONMENT_ID]: environment,
    },
  };
}

describe("agent terminal notification logic", () => {
  it("detects only completed and error turns with completion timestamps as terminal", () => {
    expect(isTerminalAgentTurn(turn({ state: "completed", completedAt: ISO_COMPLETED }))).toBe(
      true,
    );
    expect(isTerminalAgentTurn(turn({ state: "error", completedAt: ISO_COMPLETED }))).toBe(true);
    expect(isTerminalAgentTurn(turn({ state: "completed", completedAt: null }))).toBe(false);
    expect(isTerminalAgentTurn(turn({ state: "interrupted", completedAt: ISO_COMPLETED }))).toBe(
      false,
    );
  });

  it("does not notify for initially hydrated completed threads", () => {
    const next = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "completed", completedAt: ISO_COMPLETED }))],
      }),
    );

    expect(collectAgentTerminalNotificationCandidates(null, next)).toEqual([]);
  });

  it("emits one candidate when a running turn completes", () => {
    const previous = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "running" }))],
      }),
    );
    const nextThread = threadSummary(turn({ state: "completed", completedAt: ISO_COMPLETED }));
    const next = appState(environmentState({ threads: [nextThread] }));

    const candidates = collectAgentTerminalNotificationCandidates(previous, next);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      environmentId: ENVIRONMENT_ID,
      threadId: THREAD_ID,
      state: "completed",
      completedAt: ISO_COMPLETED,
    });
    expect(formatAgentTerminalNotification(candidates[0]!)).toEqual({
      title: "Fix notifications",
      body: "Agent finished in T3 Code",
    });
  });

  it("emits one candidate when a running turn fails", () => {
    const previous = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "running" }))],
      }),
    );
    const next = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "error", completedAt: ISO_COMPLETED }))],
      }),
    );

    const candidates = collectAgentTerminalNotificationCandidates(previous, next);

    expect(candidates).toHaveLength(1);
    expect(formatAgentTerminalNotification(candidates[0]!)).toEqual({
      title: "Fix notifications",
      body: "Agent failed in T3 Code",
    });
  });

  it("does not re-emit the same terminal state", () => {
    const latestTurn = turn({ state: "completed", completedAt: ISO_COMPLETED });
    const previous = appState(environmentState({ threads: [threadSummary(latestTurn)] }));
    const next = appState(environmentState({ threads: [threadSummary(latestTurn)] }));

    expect(collectAgentTerminalNotificationCandidates(previous, next)).toEqual([]);
  });

  it("does not emit interrupted turns", () => {
    const previous = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "running" }))],
      }),
    );
    const next = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "interrupted", completedAt: ISO_COMPLETED }))],
      }),
    );

    expect(collectAgentTerminalNotificationCandidates(previous, next)).toEqual([]);
  });

  it("emits again for a later terminal turn on the same thread", () => {
    const previous = appState(
      environmentState({
        threads: [
          threadSummary(turn({ state: "completed", turnId: "turn-1", completedAt: ISO_COMPLETED })),
        ],
      }),
    );
    const next = appState(
      environmentState({
        threads: [
          threadSummary(
            turn({
              state: "completed",
              turnId: "turn-2",
              completedAt: "2026-06-16T12:05:00.000Z",
            }),
          ),
        ],
      }),
    );

    expect(collectAgentTerminalNotificationCandidates(previous, next)).toHaveLength(1);
  });

  it("dedupes duplicate summary writes by notification key", () => {
    const previous = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "running" }))],
      }),
    );
    const nextThread = threadSummary(turn({ state: "completed", completedAt: ISO_COMPLETED }));
    const nextEnvironment = environmentState({ threads: [nextThread] });
    nextEnvironment.sidebarThreadSummaryById = {
      [THREAD_ID]: nextThread,
      duplicate: nextThread,
    } as EnvironmentState["sidebarThreadSummaryById"];

    expect(
      collectAgentTerminalNotificationCandidates(previous, appState(nextEnvironment)),
    ).toHaveLength(1);
  });

  it("falls back to this project when the project is missing", () => {
    const previous = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "running" }))],
        projects: [],
      }),
    );
    const next = appState(
      environmentState({
        threads: [threadSummary(turn({ state: "completed", completedAt: ISO_COMPLETED }))],
        projects: [],
      }),
    );

    const [candidate] = collectAgentTerminalNotificationCandidates(previous, next);

    expect(formatAgentTerminalNotification(candidate!)).toEqual({
      title: "Fix notifications",
      body: "Agent finished in this project",
    });
  });
});

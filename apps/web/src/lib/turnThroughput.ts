import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type TurnThroughputProjection = {
  readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "activeProviderThreadId">;
  readonly providerThreads: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["providerThreads"][number],
      "id" | "providerInstanceId" | "nativeThreadRef"
    >
  >;
  readonly providerTurns: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["providerTurns"][number],
      | "providerThreadId"
      | "runAttemptId"
      | "ordinal"
      | "status"
      | "startedAt"
      | "completedAt"
      | "turnTokenUsage"
    >
  >;
  readonly attempts: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["attempts"][number],
      "id" | "runId" | "providerThreadId" | "providerInstanceId" | "status" | "nativeThreadId"
    >
  >;
  readonly runs: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["runs"][number],
      "id" | "ordinal" | "activeAttemptId" | "status" | "modelSelection" | "providerThreadId"
    >
  >;
};

/**
 * Output includes reasoning; elapsed time includes tools and waits. This is
 * completed-turn throughput, not model generation speed. Only the latest
 * turn may supply it, so a new or rewound run cannot reuse an older rate.
 */
export function deriveLatestTurnThroughput(projection: TurnThroughputProjection | null) {
  if (projection === null || projection.thread.activeProviderThreadId === null) return null;
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  if (providerThread === undefined) return null;

  let latestTurn: TurnThroughputProjection["providerTurns"][number] | undefined;
  for (const turn of projection.providerTurns) {
    if (turn.providerThreadId !== providerThread.id) continue;
    if (latestTurn === undefined || turn.ordinal > latestTurn.ordinal) latestTurn = turn;
  }
  if (
    latestTurn === undefined ||
    latestTurn.status !== "completed" ||
    latestTurn.turnTokenUsage?.usageStatus !== "complete" ||
    latestTurn.startedAt === null ||
    latestTurn.completedAt === null
  ) {
    return null;
  }

  const attempt = projection.attempts.find((entry) => entry.id === latestTurn.runAttemptId);
  const nativeId = providerThread.nativeThreadRef?.nativeId;
  if (
    attempt === undefined ||
    attempt.status !== "completed" ||
    attempt.providerThreadId !== providerThread.id ||
    attempt.providerInstanceId !== providerThread.providerInstanceId ||
    (nativeId !== undefined && attempt.nativeThreadId !== nativeId)
  ) {
    return null;
  }
  let latestRun: TurnThroughputProjection["runs"][number] | undefined;
  for (const run of projection.runs) {
    if (run.status === "rolled_back") continue;
    if (latestRun === undefined || run.ordinal > latestRun.ordinal) latestRun = run;
  }
  if (
    latestRun === undefined ||
    latestRun.id !== attempt.runId ||
    latestRun.activeAttemptId !== attempt.id ||
    latestRun.providerThreadId !== providerThread.id ||
    latestRun.modelSelection.instanceId !== providerThread.providerInstanceId ||
    latestRun.status !== "completed"
  ) {
    return null;
  }

  const outputTokens = latestTurn.turnTokenUsage.outputTokens;
  const durationMs =
    DateTime.toEpochMillis(latestTurn.completedAt) - DateTime.toEpochMillis(latestTurn.startedAt);
  if (
    !Number.isFinite(outputTokens) ||
    outputTokens < 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }
  const tokensPerSecond = outputTokens / (durationMs / 1_000);
  if (!Number.isFinite(tokensPerSecond)) return null;

  return {
    providerInstanceId: providerThread.providerInstanceId,
    modelSelection: latestRun.modelSelection,
    tokensPerSecond,
    outputTokens,
    durationMs,
  };
}

export type TurnThroughput = NonNullable<ReturnType<typeof deriveLatestTurnThroughput>>;

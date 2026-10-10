import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";

type ProviderTurnUsageProjection = {
  readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "activeProviderThreadId">;
  readonly providerThreads: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["providerThreads"][number],
      "id" | "nativeThreadRef" | "lastRunOrdinal"
    >
  >;
  readonly providerTurns: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["providerTurns"][number],
      "providerThreadId" | "ordinal" | "tokenUsage" | "runAttemptId"
    >
  >;
  readonly attempts: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["attempts"][number],
      "id" | "runId" | "status" | "nativeThreadId" | "providerThreadId"
    >
  >;
  readonly runs: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["runs"][number],
      "id" | "status" | "activeAttemptId" | "ordinal" | "providerThreadId" | "modelSelection"
    >
  >;
};

/**
 * Keep context between turns. A rejected report must also suppress the thread
 * fallback: rollback can retain its old contextUsage while refreshing updatedAt.
 */
export function selectActiveProviderThreadUsage(projection: ProviderTurnUsageProjection | null) {
  const unavailable = { usage: null, allowFallback: false } as const;
  if (projection === null || projection.thread.activeProviderThreadId === null) return unavailable;
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  if (providerThread === undefined) return unavailable;
  let latestTurn: ProviderTurnUsageProjection["providerTurns"][number] | undefined;
  let latest: ProviderTurnUsageProjection["providerTurns"][number] | undefined;
  for (const turn of projection.providerTurns) {
    if (turn.providerThreadId !== providerThread.id) continue;
    if (latestTurn === undefined || turn.ordinal > latestTurn.ordinal) latestTurn = turn;
    if (turn.tokenUsage === undefined) continue;
    if (latest === undefined || turn.ordinal > latest.ordinal) latest = turn;
  }
  const ownerOf = (turn: ProviderTurnUsageProjection["providerTurns"][number]) => {
    const attempt = projection.attempts.find((entry) => entry.id === turn.runAttemptId);
    const run = projection.runs.find((entry) => entry.id === attempt?.runId);
    const nativeId = providerThread.nativeThreadRef?.nativeId;
    if (
      attempt === undefined ||
      attempt.status === "superseded" ||
      attempt.providerThreadId !== providerThread.id ||
      (nativeId !== undefined && attempt.nativeThreadId !== nativeId) ||
      run === undefined ||
      run.status === "rolled_back" ||
      run.activeAttemptId !== attempt.id
    ) {
      return null;
    }
    return run;
  };
  if (latestTurn?.runAttemptId != null && ownerOf(latestTurn) === null) return unavailable;
  if (latest?.runAttemptId != null) {
    const owner = ownerOf(latest);
    if (owner === null) return unavailable;
    const currentOwner = projection.runs.find(
      (run) =>
        run.ordinal === providerThread.lastRunOrdinal && run.providerThreadId === providerThread.id,
    );
    // The server adjusts the retained occupancy to the new model's window
    // before starting its turn. An old model report must not override that.
    if (currentOwner && !modelSelectionsEqual(owner.modelSelection, currentOwner.modelSelection)) {
      return { usage: null, allowFallback: true } as const;
    }
  }
  return { usage: latest?.tokenUsage ?? null, allowFallback: true } as const;
}

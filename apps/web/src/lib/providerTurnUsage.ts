import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";

type ProviderTurnUsageProjection = {
  readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "activeProviderThreadId">;
  readonly providerThreads: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["providerThreads"][number],
      "id" | "providerInstanceId" | "nativeThreadRef" | "lastRunOrdinal" | "nativeMetadata"
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
      "id" | "runId" | "status" | "nativeThreadId" | "providerThreadId" | "providerInstanceId"
    >
  >;
  readonly runs: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadProjection["runs"][number],
      | "id"
      | "status"
      | "startedAt"
      | "activeAttemptId"
      | "ordinal"
      | "providerThreadId"
      | "modelSelection"
    >
  >;
};

/**
 * Keep context between turns. A rejected report must also suppress the thread
 * fallback: rollback can retain its old contextUsage while refreshing updatedAt.
 */
export function selectActiveProviderThreadUsage(projection: ProviderTurnUsageProjection | null) {
  const unavailable = { usage: null, allowFallback: false, modelSelection: null } as const;
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
      attempt.providerInstanceId !== providerThread.providerInstanceId ||
      (nativeId !== undefined && attempt.nativeThreadId !== nativeId) ||
      run === undefined ||
      run.status === "rolled_back" ||
      run.providerThreadId !== providerThread.id ||
      run.modelSelection.instanceId !== providerThread.providerInstanceId ||
      run.activeAttemptId !== attempt.id
    ) {
      return null;
    }
    return run;
  };
  const currentOwner = projection.runs.find(
    (run) =>
      run.ordinal === providerThread.lastRunOrdinal &&
      run.providerThreadId === providerThread.id &&
      run.modelSelection.instanceId === providerThread.providerInstanceId &&
      run.startedAt !== null &&
      run.status !== "rolled_back",
  );
  const nativeSelection = providerThread.nativeMetadata?.modelSelection;
  const reportedModelSelection =
    nativeSelection?.instanceId === providerThread.providerInstanceId ? nativeSelection : null;
  if (latestTurn?.runAttemptId != null && ownerOf(latestTurn) === null) return unavailable;
  if (latest?.runAttemptId != null) {
    const owner = ownerOf(latest);
    if (owner === null) return unavailable;
    // The server adjusts the retained occupancy to the new model's window
    // before starting its turn. An old model report must not override that.
    if (currentOwner && !modelSelectionsEqual(owner.modelSelection, currentOwner.modelSelection)) {
      return {
        usage: null,
        allowFallback: true,
        modelSelection: currentOwner.modelSelection,
      } as const;
    }
    return {
      usage: latest.tokenUsage ?? null,
      allowFallback: true,
      modelSelection: owner.modelSelection,
    } as const;
  }
  // Setup advances lastRunOrdinal before changing contextUsage, and may update
  // native model metadata even if the new run never starts. Without a measured
  // report, neither that run nor its metadata can identify the retained context.
  if (latest === undefined && providerThread.lastRunOrdinal !== null && !currentOwner) {
    return unavailable;
  }
  return {
    usage: latest?.tokenUsage ?? null,
    allowFallback: true,
    // Runless native agents report their own model. Without a measured turn,
    // the current run owns any server-adjusted provider-thread fallback.
    modelSelection:
      latest === undefined
        ? (currentOwner?.modelSelection ?? reportedModelSelection)
        : reportedModelSelection,
  } as const;
}

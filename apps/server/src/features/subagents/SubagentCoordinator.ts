import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationThread,
} from "@t3tools/contracts";
import {
  SUBAGENT_METADATA_ACTIVITY,
  SUBAGENT_RUN_SETTLED_ACTIVITY,
  SUBAGENT_RUN_STATE_ACTIVITY,
  SUBAGENT_SUMMARY_UPDATED_ACTIVITY,
  decodeSubagentRunActivity,
  foldSubagentSummaries,
} from "@t3tools/fork-subagents/activities";
import {
  SUBAGENT_REASONING_EFFORTS,
  SubagentId,
  type SubagentCheckResult,
  type SubagentOutputSection,
  type SubagentRunResult,
  type SubagentSummary,
} from "@t3tools/fork-subagents/contracts";
import { isSubagentThreadId, makeSubagentThreadId } from "@t3tools/fork-subagents/threads";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as Metric from "effect/Metric";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { increment } from "../../observability/Metrics.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  SubagentCoordinator,
  SubagentCoordinatorError,
  type SubagentCoordinatorShape,
} from "./CoordinatorService.ts";
import {
  subagentActiveChildren,
  subagentCancelsTotal,
  subagentCompletionsTotal,
  subagentDeliveriesTotal,
  subagentSpawnsTotal,
  subagentStaleReconciliationsTotal,
  subagentWaitsTotal,
} from "./Metrics.ts";
import { SubagentRepository, SubagentRepositoryLive } from "./SubagentRepository.ts";

const ERROR_LIMIT = 4_096;
const EFFORT_ORDER = SUBAGENT_REASONING_EFFORTS;
type WaitInterestMap = ReadonlyMap<string, number>;
const encodeDeliveryEnvelope = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("subagent_result"),
      childId: SubagentId,
      childThreadId: ThreadId,
      title: Schema.String,
      outcome: Schema.Literals(["completed", "failed", "interrupted"]),
      error: Schema.NullOr(Schema.String),
      output: Schema.String,
    }),
  ),
);

const fail = (operation: string, detail: string) =>
  new SubagentCoordinatorError({ operation, detail });

function uuidFromDigest(digest: Uint8Array): string {
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function truncateLatestText(text: string, maxChars: number, maxLines: number) {
  const lines = text.split("\n");
  let value = lines.slice(-maxLines).join("\n");
  const truncated = lines.length > maxLines || value.length > maxChars;
  const notice = "[earlier output truncated; open the child thread for full output]\n\n";
  if (truncated) {
    value = `${notice}${value.slice(-Math.max(0, maxChars - notice.length))}`.slice(-maxChars);
  }
  return { text: value, truncated };
}

function runResults(thread: OrchestrationThread): ReadonlyArray<SubagentRunResult> {
  const byTurn = new Map<string, SubagentRunResult>();
  for (const activity of thread.activities) {
    if (
      activity.kind !== SUBAGENT_RUN_SETTLED_ACTIVITY &&
      activity.kind !== SUBAGENT_RUN_STATE_ACTIVITY
    )
      continue;
    const payload = decodeSubagentRunActivity(activity.payload);
    if (payload) byTurn.set(payload.result.childTurnId, payload.result);
  }
  return [...byTurn.values()];
}

function currentRunResult(thread: OrchestrationThread): SubagentRunResult | undefined {
  const results = runResults(thread);
  const latestResult = results.at(-1);
  const latestUserMessageAt = thread.messages.reduce(
    (latest, message) =>
      message.role === "user" ? Math.max(latest, Date.parse(message.createdAt)) : latest,
    Number.NEGATIVE_INFINITY,
  );
  if (latestResult && latestUserMessageAt > Date.parse(latestResult.settledAt)) {
    return undefined;
  }
  if (thread.latestTurn?.turnId) {
    return results.find((result) => result.childTurnId === thread.latestTurn?.turnId);
  }
  return latestResult;
}

function isRunningChild(thread: OrchestrationThread): boolean {
  if (thread.session?.status === "starting" || thread.session?.status === "running") return true;
  return currentRunResult(thread) === undefined;
}

function adjustWaitInterests(
  current: WaitInterestMap,
  childThreadIds: ReadonlyArray<ThreadId>,
  delta: 1 | -1,
): WaitInterestMap {
  const next = new Map(current);
  for (const childThreadId of childThreadIds) {
    const count = Math.max(0, (next.get(childThreadId) ?? 0) + delta);
    if (count === 0) next.delete(childThreadId);
    else next.set(childThreadId, count);
  }
  return next;
}

function outputForTurn(thread: OrchestrationThread, turnId: string): string {
  return thread.messages
    .filter((message) => message.role === "assistant" && message.turnId === turnId)
    .map((message) => message.text)
    .join("\n\n")
    .trim();
}

function latestAssistantOutput(thread: OrchestrationThread): string {
  const latestTurnOutput = thread.latestTurn?.turnId
    ? outputForTurn(thread, thread.latestTurn.turnId)
    : "";
  if (latestTurnOutput.length > 0) return latestTurnOutput;
  return thread.messages.findLast((message) => message.role === "assistant")?.text.trim() ?? "";
}

function latestContextUsage(thread: OrchestrationThread) {
  for (const activity of thread.activities.toReversed()) {
    if (activity.kind !== "context-window.updated") continue;
    const payload = activity.payload;
    if (typeof payload !== "object" || payload === null) continue;
    const usedTokens = "usedTokens" in payload ? payload.usedTokens : undefined;
    const maxTokens = "maxTokens" in payload ? payload.maxTokens : undefined;
    if (
      typeof usedTokens === "number" &&
      Number.isInteger(usedTokens) &&
      usedTokens >= 0 &&
      typeof maxTokens === "number" &&
      Number.isInteger(maxTokens) &&
      maxTokens >= 0
    ) {
      return { usedTokens, maxTokens };
    }
  }
  return null;
}

function pendingAttention(thread: OrchestrationThread): {
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
} {
  const approvals = new Set<string>();
  const userInputs = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (!requestId) continue;
    const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
    if (activity.kind === "approval.requested") approvals.add(requestId);
    if (activity.kind === "approval.resolved") approvals.delete(requestId);
    if (activity.kind === "user-input.requested") userInputs.add(requestId);
    if (activity.kind === "user-input.resolved") userInputs.delete(requestId);
    if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      detail !== null &&
      (detail.includes("stale pending") || detail.includes("unknown pending"))
    ) {
      approvals.delete(requestId);
      userInputs.delete(requestId);
    }
  }
  return {
    hasPendingApproval: approvals.size > 0,
    hasPendingUserInput: userInputs.size > 0,
  };
}

function nearestEffort(requested: string, supported: ReadonlyArray<string>): string | undefined {
  if (supported.length === 0) return undefined;
  const requestedIndex = EFFORT_ORDER.indexOf(requested as (typeof EFFORT_ORDER)[number]);
  return supported.toSorted((left, right) => {
    const leftIndex = EFFORT_ORDER.indexOf(left as (typeof EFFORT_ORDER)[number]);
    const rightIndex = EFFORT_ORDER.indexOf(right as (typeof EFFORT_ORDER)[number]);
    return Math.abs(leftIndex - requestedIndex) - Math.abs(rightIndex - requestedIndex);
  })[0];
}

function subagentSummariesEqual(left: SubagentSummary, right: SubagentSummary): boolean {
  return (
    left.threadId === right.threadId &&
    left.displayId === right.displayId &&
    left.title === right.title &&
    left.providerInstanceId === right.providerInstanceId &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.cwd === right.cwd &&
    left.status === right.status &&
    left.outcome === right.outcome &&
    left.createdAt === right.createdAt &&
    left.settledAt === right.settledAt &&
    left.turnCount === right.turnCount &&
    left.contextUsage?.usedTokens === right.contextUsage?.usedTokens &&
    left.contextUsage?.maxTokens === right.contextUsage?.maxTokens &&
    left.hasPendingApproval === right.hasPendingApproval &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.error === right.error
  );
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry;
  const providerService = yield* ProviderService;
  const repository = yield* SubagentRepository;
  const cancelledStartups = yield* SynchronizedRef.make(new Set<string>());
  const waitInterests = yield* SynchronizedRef.make<WaitInterestMap>(new Map());
  const transitionLock = yield* SynchronizedRef.make(0);
  const reconcileSemaphore = yield* Semaphore.make(1);
  const coordinatorScope = yield* Effect.scope;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const commandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((id) => CommandId.make(`server:subagent:${tag}:${id}`)),
      Effect.orDie,
    );
  const eventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make), Effect.orDie);
  const deliveryMessageId = (childThreadId: ThreadId, turnId: TurnId) =>
    crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(`t3-subagent-delivery\0${childThreadId}\0${turnId}`),
      )
      .pipe(Effect.map(uuidFromDigest), Effect.map(MessageId.make), Effect.orDie);
  const deliveryCommandId = (childThreadId: ThreadId, turnId: TurnId) =>
    crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(`t3-subagent-delivery-command\0${childThreadId}\0${turnId}`),
      )
      .pipe(
        Effect.map(uuidFromDigest),
        Effect.map((id) => CommandId.make(`server:subagent:deliver:${id}`)),
        Effect.orDie,
      );

  const getThread = (threadId: ThreadId) =>
    snapshots.getThreadDetailById(threadId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.mapError((cause) =>
        fail("read", `Could not read thread '${threadId}': ${cause.message}`),
      ),
    );

  const childrenFor = Effect.fn("SubagentCoordinator.childrenFor")(function* (
    parentThreadId: ThreadId,
  ) {
    const relations = yield* repository
      .listByParentId(parentThreadId)
      .pipe(Effect.mapError((cause) => fail("list", cause.message)));
    return yield* Effect.forEach(relations, (relation) =>
      getThread(relation.childThreadId).pipe(
        Effect.map((thread) => (thread ? [{ thread, relation }] : [])),
      ),
    ).pipe(Effect.map((groups) => groups.flat()));
  });

  const relationFor = Effect.fn("SubagentCoordinator.relationFor")(function* (
    childThreadId: ThreadId,
  ) {
    const relation = yield* repository
      .getByChildId(childThreadId)
      .pipe(Effect.mapError((cause) => fail("relation", cause.message)));
    if (!relation) return yield* fail("relation", `Thread '${childThreadId}' is not managed.`);
    return relation;
  });

  const appendActivity = Effect.fn("SubagentCoordinator.appendActivity")(function* (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly turnId?: TurnId | null;
  }) {
    const createdAt = yield* nowIso;
    yield* engine
      .dispatch({
        type: "thread.activity.append",
        commandId: yield* commandId(input.kind),
        threadId: input.threadId,
        activity: {
          id: yield* eventId(),
          tone: input.kind === SUBAGENT_SUMMARY_UPDATED_ACTIVITY ? "info" : "tool",
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: input.turnId ?? null,
          createdAt,
        },
        createdAt,
      })
      .pipe(Effect.mapError((cause) => fail("persist", cause.message)));
  });

  const summaryFor = Effect.fn("SubagentCoordinator.summaryFor")(function* (
    child: OrchestrationThread,
    override?: Partial<SubagentSummary>,
  ) {
    const relation = yield* relationFor(child.id);
    const results = runResults(child);
    const latestResult = results.at(-1) ?? null;
    const running = isRunningChild(child);
    const attention = pendingAttention(child);
    const status = running
      ? "running"
      : latestResult?.outcome === "failed"
        ? "error"
        : latestResult
          ? "done"
          : "running";
    return {
      threadId: child.id,
      displayId: relation.displayId,
      title: child.title,
      providerInstanceId: child.modelSelection.instanceId,
      provider: relation.provider,
      model: child.modelSelection.model,
      cwd: relation.cwd,
      status,
      outcome: running ? null : (latestResult?.outcome ?? null),
      createdAt: relation.createdAt,
      settledAt: running ? null : (latestResult?.settledAt ?? null),
      turnCount: new Set(
        child.messages.flatMap((message) => (message.turnId ? [message.turnId] : [])),
      ).size,
      contextUsage: latestContextUsage(child),
      ...attention,
      error: running ? null : (latestResult?.error ?? child.session?.lastError ?? null),
      ...override,
    } satisfies SubagentSummary;
  });

  const publishSummary = Effect.fn("SubagentCoordinator.publishSummary")(function* (
    child: OrchestrationThread,
    override?: Partial<SubagentSummary>,
  ) {
    const relation = yield* relationFor(child.id);
    const summary = yield* summaryFor(child, override);
    yield* repository
      .updateProjection({
        childThreadId: child.id,
        updatedAt: child.updatedAt,
        status: summary.status,
        outcome: summary.outcome,
        settledAt: summary.settledAt,
        hasPendingApproval: summary.hasPendingApproval,
        hasPendingUserInput: summary.hasPendingUserInput,
        turnCount: summary.turnCount,
        contextUsage: summary.contextUsage,
        error: summary.error,
      })
      .pipe(Effect.mapError((cause) => fail("summary", cause.message)));
    yield* appendActivity({
      threadId: relation.parentThreadId,
      kind: SUBAGENT_SUMMARY_UPDATED_ACTIVITY,
      summary: `${summary.displayId}: ${summary.status}`,
      payload: { summary },
    });
  });

  const publishSummaryIfChanged = Effect.fn("SubagentCoordinator.publishSummaryIfChanged")(
    function* (child: OrchestrationThread) {
      const relation = yield* relationFor(child.id);
      const summary = yield* summaryFor(child);
      const parent = yield* getThread(relation.parentThreadId);
      const current = parent
        ? foldSubagentSummaries(parent.activities).find(
            (candidate) => candidate.threadId === child.id,
          )
        : undefined;
      if (current && subagentSummariesEqual(current, summary)) return;
      yield* publishSummary(child);
    },
  );

  const settleUnlocked = Effect.fn("SubagentCoordinator.settleUnlocked")(function* (
    child: OrchestrationThread,
    forcedOutcome?: "completed" | "failed" | "interrupted",
    forcedError?: string | null,
  ) {
    const turnId =
      child.latestTurn?.turnId ??
      (forcedOutcome ? TurnId.make(`subagent-startup:${child.id}`) : undefined);
    if (!turnId) return undefined;
    const existing = runResults(child).find((result) => result.childTurnId === turnId);
    if (existing) return existing;
    const sessionStatus = child.session?.status;
    if (!forcedOutcome && (sessionStatus === "starting" || sessionStatus === "running")) {
      return undefined;
    }
    const outcome =
      forcedOutcome ??
      (child.latestTurn?.state === "error" || sessionStatus === "error"
        ? "failed"
        : child.latestTurn?.state === "interrupted" ||
            sessionStatus === "interrupted" ||
            sessionStatus === "stopped"
          ? "interrupted"
          : "completed");
    const settledAt = yield* nowIso;
    const result: SubagentRunResult = {
      childTurnId: turnId,
      outcome,
      error: (forcedError ?? child.session?.lastError ?? null)?.slice(0, ERROR_LIMIT) ?? null,
      state: "pending",
      deliveryMessageId: yield* deliveryMessageId(child.id, turnId),
      settledAt,
    };
    yield* appendActivity({
      threadId: child.id,
      kind: SUBAGENT_RUN_SETTLED_ACTIVITY,
      summary: `Subagent run ${outcome}`,
      payload: { result },
      turnId,
    });
    yield* increment(subagentCompletionsTotal, { outcome });
    const refreshed = (yield* getThread(child.id)) ?? child;
    yield* publishSummary(refreshed, {
      status: outcome === "failed" ? "error" : "done",
      outcome,
      settledAt,
      error: result.error,
    });
    return result;
  });

  const settle = Effect.fn("SubagentCoordinator.settle")(function* (
    child: OrchestrationThread,
    forcedOutcome?: "completed" | "failed" | "interrupted",
    forcedError?: string | null,
  ) {
    return yield* SynchronizedRef.modifyEffect(transitionLock, (version) =>
      Effect.gen(function* () {
        const refreshed = (yield* getThread(child.id)) ?? child;
        const result = yield* settleUnlocked(refreshed, forcedOutcome, forcedError);
        return [result, result ? version + 1 : version] as const;
      }),
    );
  });

  const transitionResult = Effect.fn("SubagentCoordinator.transitionResult")(function* (
    child: OrchestrationThread,
    result: SubagentRunResult,
    state: "consumed" | "delivered",
  ) {
    yield* SynchronizedRef.modifyEffect(transitionLock, (version) =>
      Effect.gen(function* () {
        const refreshed = yield* getThread(child.id);
        if (!refreshed) return [false, version] as const;
        const current = runResults(refreshed).find(
          (candidate) => candidate.childTurnId === result.childTurnId,
        );
        if (!current || current.state !== "pending") return [false, version] as const;
        yield* appendActivity({
          threadId: child.id,
          kind: SUBAGENT_RUN_STATE_ACTIVITY,
          summary: `Subagent result ${state}`,
          payload: { result: { ...current, state } },
          turnId: current.childTurnId,
        });
        return [true, version + 1] as const;
      }),
    );
  });

  const deliverPending = Effect.fn("SubagentCoordinator.deliverPending")(function* (
    child: OrchestrationThread,
  ) {
    const relation = yield* relationFor(child.id);
    const result = runResults(child).find((candidate) => candidate.state === "pending");
    if (!result) return;
    const parent = yield* getThread(relation.parentThreadId);
    if (!parent || parent.deletedAt !== null || parent.archivedAt !== null) return;
    if (parent.session?.status !== "ready") return;
    const envelope = encodeDeliveryEnvelope({
      type: "subagent_result",
      childId: relation.displayId,
      childThreadId: child.id,
      title: child.title,
      outcome: result.outcome,
      error: result.error,
      output: outputForTurn(child, result.childTurnId),
    });
    yield* SynchronizedRef.modifyEffect(transitionLock, (version) =>
      Effect.gen(function* () {
        const refreshed = yield* getThread(child.id);
        if (!refreshed) return [false, version] as const;
        const current = runResults(refreshed).find(
          (candidate) => candidate.childTurnId === result.childTurnId,
        );
        if (!current || current.state !== "pending") return [false, version] as const;
        const interests = yield* SynchronizedRef.get(waitInterests);
        if ((interests.get(child.id) ?? 0) > 0) return [false, version] as const;
        const sent = yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: yield* deliveryCommandId(child.id, current.childTurnId),
            threadId: parent.id,
            message: {
              messageId: current.deliveryMessageId,
              role: "user",
              text: envelope,
              attachments: [],
            },
            modelSelection: parent.modelSelection,
            runtimeMode: parent.runtimeMode,
            interactionMode: parent.interactionMode,
            createdAt: current.settledAt,
          })
          .pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
        yield* increment(subagentDeliveriesTotal, { outcome: sent ? "success" : "retry" });
        if (!sent) return [false, version] as const;
        yield* appendActivity({
          threadId: child.id,
          kind: SUBAGENT_RUN_STATE_ACTIVITY,
          summary: "Subagent result delivered",
          payload: { result: { ...current, state: "delivered" } },
          turnId: current.childTurnId,
        });
        return [true, version + 1] as const;
      }),
    );
  });

  const reconcileUnsafe = Effect.fn("SubagentCoordinator.reconcileUnsafe")(function* () {
    const snapshot = yield* snapshots.getSnapshot().pipe(Effect.orElseSucceed(() => null));
    if (!snapshot) return;
    const relations = yield* repository.listAll().pipe(Effect.orElseSucceed(() => []));
    const threadsById = new Map(snapshot.threads.map((thread) => [thread.id, thread] as const));
    const timestamp = yield* Clock.currentTimeMillis;
    const liveSessions = yield* providerService.listSessions();
    const liveThreadIds = new Set(liveSessions.map((session) => session.threadId));
    yield* Metric.update(
      subagentActiveChildren,
      relations.filter((relation) => relation.status === "running").length,
    );
    for (const relation of relations) {
      const child = threadsById.get(relation.childThreadId);
      const parent = threadsById.get(relation.parentThreadId);
      if (!child) {
        if (
          relation.lifecycle === "reserved" &&
          timestamp - Date.parse(relation.createdAt) > 10_000
        ) {
          yield* repository.release(relation.childThreadId).pipe(Effect.ignore);
        }
        continue;
      }
      if (!parent || parent.deletedAt !== null) {
        yield* providerService.stopSession({ threadId: child.id }).pipe(Effect.ignore);
        yield* engine
          .dispatch({
            type: "thread.delete",
            commandId: yield* commandId("parent-delete"),
            threadId: child.id,
          })
          .pipe(Effect.ignore);
        yield* repository.deleteByChildId(child.id).pipe(Effect.ignore);
        continue;
      }
      if (
        parent &&
        (parent.session?.status === "stopped" || parent.session?.status === "interrupted") &&
        isRunningChild(child)
      ) {
        yield* providerService.stopSession({ threadId: child.id }).pipe(Effect.ignore);
        yield* settle(child, "interrupted", "Parent session stopped.");
      }
      let current = child;
      if (
        (child.session?.status === "starting" || child.session?.status === "running") &&
        !liveThreadIds.has(child.id) &&
        timestamp - Date.parse(child.createdAt) > 10_000
      ) {
        yield* increment(subagentStaleReconciliationsTotal, { outcome: "failed" });
        yield* settle(child, "failed", "Subagent provider session was not live after restart.");
        current = (yield* getThread(child.id)) ?? child;
      } else {
        yield* settle(child);
        current = (yield* getThread(child.id)) ?? child;
      }
      yield* publishSummaryIfChanged(current);
      yield* deliverPending(current);
    }
  });

  const reconcile = Effect.fn("SubagentCoordinator.reconcile")(() =>
    reconcileSemaphore.withPermits(1)(reconcileUnsafe()),
  );

  yield* Effect.forkIn(
    Effect.forever(reconcile().pipe(Effect.andThen(Effect.sleep("1 second")))),
    coordinatorScope,
  );
  yield* Effect.forkIn(
    Stream.runForEach(engine.streamDomainEvents, (event) => {
      const shouldReconcile =
        event.type === "thread.deleted" ||
        event.type === "thread.session-stop-requested" ||
        event.type === "thread.session-set" ||
        (event.type === "thread.activity-appended" &&
          (isSubagentThreadId(event.aggregateId) ||
            event.payload.activity.kind === "approval.requested" ||
            event.payload.activity.kind === "approval.resolved" ||
            event.payload.activity.kind === "user-input.requested" ||
            event.payload.activity.kind === "user-input.resolved"));
      return shouldReconcile ? reconcile() : Effect.void;
    }),
    coordinatorScope,
  );

  const spawn: SubagentCoordinatorShape["spawn"] = Effect.fn("SubagentCoordinator.spawn")(
    function* (parentThreadId, request) {
      if (request.agent !== undefined && request.providerInstanceId !== undefined) {
        return yield* fail("spawn", "agent and provider_instance_id are mutually exclusive.");
      }
      const prompt = request.prompt.trim();
      if (prompt.length === 0) return yield* fail("spawn", "prompt must not be empty.");
      const parent = yield* getThread(parentThreadId);
      if (!parent) return yield* fail("spawn", `Parent thread '${parentThreadId}' was not found.`);
      if (isSubagentThreadId(parent.id)) {
        return yield* fail("spawn", "T3-managed subagents cannot spawn descendants.");
      }
      const project = yield* snapshots.getProjectShellById(parent.projectId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError((cause) => fail("spawn", cause.message)),
      );
      if (!project) return yield* fail("spawn", "The parent project is unavailable.");
      const checkout = resolveThreadWorkspaceCwd({ thread: parent, projects: [project] });
      if (!checkout) return yield* fail("spawn", "The parent checkout could not be resolved.");
      const checkoutReal = yield* fileSystem
        .realPath(checkout)
        .pipe(
          Effect.mapError(() => fail("spawn", `Parent checkout '${checkout}' does not exist.`)),
        );
      const requestedPath = request.workingDir
        ? path.isAbsolute(request.workingDir)
          ? request.workingDir
          : path.resolve(checkoutReal, request.workingDir)
        : checkoutReal;
      const cwd = yield* fileSystem
        .realPath(requestedPath)
        .pipe(
          Effect.mapError(() => fail("spawn", `working_dir '${requestedPath}' does not exist.`)),
        );
      const cwdInfo = yield* fileSystem
        .stat(cwd)
        .pipe(Effect.mapError(() => fail("spawn", `working_dir '${cwd}' cannot be inspected.`)));
      if (cwdInfo.type !== "Directory")
        return yield* fail("spawn", `working_dir '${cwd}' is not a directory.`);
      const relative = path.relative(checkoutReal, cwd);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return yield* fail("spawn", "working_dir must remain inside the parent checkout.");
      }

      const providerSnapshots = yield* providers.getProviders;
      const desiredDriver = request.agent === "claude" ? "claudeAgent" : request.agent;
      const inherited = request.agent === undefined && request.providerInstanceId === undefined;
      const providerSnapshot = inherited
        ? providerSnapshots.find(
            (provider) => provider.instanceId === parent.modelSelection.instanceId,
          )
        : request.providerInstanceId
          ? providerSnapshots.find((provider) => provider.instanceId === request.providerInstanceId)
          : (providerSnapshots.find(
              (provider) =>
                provider.driver === desiredDriver &&
                String(provider.instanceId) === String(provider.driver),
            ) ?? providerSnapshots.find((provider) => provider.driver === desiredDriver));
      if (!providerSnapshot)
        return yield* fail("spawn", "The selected provider instance is unknown.");
      if (
        (providerSnapshot.driver !== "codex" && providerSnapshot.driver !== "claudeAgent") ||
        !providerSnapshot.enabled ||
        !providerSnapshot.installed ||
        providerSnapshot.availability === "unavailable"
      ) {
        return yield* fail(
          "spawn",
          `Provider instance '${providerSnapshot.instanceId}' is not an enabled, available Codex or Claude instance.`,
        );
      }
      const selectedModel =
        inherited && request.model === undefined
          ? parent.modelSelection.model
          : (request.model ??
            providerSnapshot.models.find((model) => model.isDefault)?.slug ??
            providerSnapshot.models[0]?.slug);
      const modelSnapshot = providerSnapshot.models.find((model) => model.slug === selectedModel);
      if (!selectedModel || !modelSnapshot) {
        return yield* fail(
          "spawn",
          `Model '${selectedModel ?? "(default)"}' is not advertised by '${providerSnapshot.instanceId}'.`,
        );
      }
      let modelSelection: ModelSelection = inherited
        ? { ...parent.modelSelection, model: selectedModel }
        : { instanceId: providerSnapshot.instanceId, model: selectedModel };
      if (request.reasoningEffort) {
        const optionId = providerSnapshot.driver === "codex" ? "reasoningEffort" : "effort";
        const descriptor = modelSnapshot.capabilities?.optionDescriptors?.find(
          (candidate) => candidate.type === "select" && candidate.id === optionId,
        );
        const selected =
          descriptor?.type === "select"
            ? nearestEffort(
                request.reasoningEffort,
                descriptor.options.map((option) => option.id),
              )
            : undefined;
        if (!selected)
          return yield* fail(
            "spawn",
            `Model '${selectedModel}' does not advertise a supported effort option.`,
          );
        modelSelection = {
          ...modelSelection,
          options: [
            ...(modelSelection.options ?? []).filter((option) => option.id !== optionId),
            { id: optionId, value: selected },
          ],
        };
      }

      const childThreadId = makeSubagentThreadId(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
      const createdAt = yield* nowIso;
      const relation = yield* repository
        .reserve({
          childThreadId,
          parentThreadId,
          cwd,
          prompt,
          createdAt,
          providerInstanceId: providerSnapshot.instanceId,
          provider: providerSnapshot.driver,
          model: selectedModel,
        })
        .pipe(Effect.mapError((cause) => fail("spawn", cause.message)));
      return yield* Effect.gen(function* () {
        const title = request.title.trim().slice(0, 160) || relation.displayId;
        yield* engine
          .dispatch({
            type: "thread.create",
            commandId: yield* commandId("create"),
            threadId: childThreadId,
            projectId: parent.projectId,
            title,
            modelSelection,
            runtimeMode: parent.runtimeMode,
            interactionMode: "default",
            branch: parent.branch,
            worktreePath: parent.worktreePath,
            createdAt,
          })
          .pipe(Effect.mapError((cause) => fail("spawn", cause.message)));
        yield* appendActivity({
          threadId: childThreadId,
          kind: SUBAGENT_METADATA_ACTIVITY,
          summary: `${relation.displayId}: managed child`,
          payload: { relation },
        });
        yield* repository
          .activate(childThreadId, createdAt)
          .pipe(Effect.mapError((cause) => fail("spawn", cause.message)));
        const cancelled = yield* SynchronizedRef.get(cancelledStartups).pipe(
          Effect.map((ids) => ids.has(childThreadId)),
        );
        if (!cancelled) {
          yield* engine
            .dispatch({
              type: "thread.turn.start",
              commandId: yield* commandId("start"),
              threadId: childThreadId,
              message: {
                messageId: MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
                role: "user",
                text: prompt,
                attachments: [],
              },
              modelSelection,
              runtimeMode: parent.runtimeMode,
              interactionMode: "default",
              createdAt,
            })
            .pipe(Effect.mapError((cause) => fail("spawn", cause.message)));
        }
        const child = yield* getThread(childThreadId);
        if (child) yield* publishSummary(child, { status: "running" });
        yield* increment(subagentSpawnsTotal, {
          driver: providerSnapshot.driver,
          providerInstanceId: providerSnapshot.instanceId,
        });
        return { displayId: relation.displayId, threadId: childThreadId, modelSelection, cwd };
      }).pipe(
        Effect.tapError((cause) =>
          getThread(childThreadId).pipe(
            Effect.flatMap((current) =>
              current
                ? repository
                    .updateProjection({
                      childThreadId,
                      updatedAt: createdAt,
                      lifecycle: "cleanup_pending",
                      status: "error",
                      outcome: "failed",
                      settledAt: createdAt,
                      error: cause.message,
                    })
                    .pipe(Effect.andThen(settle(current, "failed", cause.message)), Effect.ignore)
                : repository.release(childThreadId).pipe(Effect.ignore),
            ),
          ),
        ),
      );
    },
  );

  const list: SubagentCoordinatorShape["list"] = Effect.fn("SubagentCoordinator.list")(
    function* (parentThreadId) {
      const children = yield* childrenFor(parentThreadId);
      const now = yield* Clock.currentTimeMillis;
      return yield* Effect.forEach(children.slice(0, 64), ({ thread }) =>
        summaryFor(thread).pipe(
          Effect.map((summary) => ({
            ...summary,
            elapsedMs: Math.max(
              0,
              (summary.settledAt ? Date.parse(summary.settledAt) : now) -
                Date.parse(summary.createdAt),
            ),
          })),
        ),
      );
    },
  );

  const findChildren = Effect.fn("SubagentCoordinator.findChildren")(function* (
    parentThreadId: ThreadId,
    displayIds: ReadonlyArray<SubagentId>,
  ) {
    if (
      displayIds.length === 0 ||
      displayIds.length > 64 ||
      new Set(displayIds).size !== displayIds.length
    ) {
      return yield* fail("ids", "Provide 1-64 unique subagent display IDs.");
    }
    const children = yield* childrenFor(parentThreadId);
    const byId = new Map(
      children.map(({ thread, relation }) => [relation.displayId, thread] as const),
    );
    const selected: OrchestrationThread[] = [];
    for (const displayId of displayIds) {
      const child = byId.get(displayId);
      if (!child) return yield* fail("ids", `Unknown subagent IDs: ${displayId}.`);
      selected.push(child);
    }
    return selected;
  });

  const wait: SubagentCoordinatorShape["wait"] = Effect.fn("SubagentCoordinator.wait")(
    function* (parentThreadId, displayIds) {
      yield* increment(subagentWaitsTotal, { operation: "wait" });
      const initial = yield* findChildren(parentThreadId, displayIds);
      const childThreadIds = initial.map((child) => child.id);
      return yield* Effect.acquireUseRelease(
        SynchronizedRef.modifyEffect(transitionLock, (version) =>
          SynchronizedRef.update(waitInterests, (current) =>
            adjustWaitInterests(current, childThreadIds, 1),
          ).pipe(Effect.as([undefined, version] as const)),
        ),
        () =>
          Effect.gen(function* () {
            const sections: SubagentOutputSection[] = [];
            for (const initialChild of initial) {
              let child = initialChild;
              const relation = yield* relationFor(child.id);
              let result: SubagentRunResult | undefined;
              while (!result) {
                yield* settle(child);
                child = (yield* getThread(child.id)) ?? child;
                result = currentRunResult(child);
                if (!result) yield* Effect.sleep("100 millis");
              }
              if (result.state === "pending") yield* transitionResult(child, result, "consumed");
              const output =
                result.state === "delivered"
                  ? "[result was already delivered to the parent thread]"
                  : outputForTurn(child, result.childTurnId);
              sections.push({
                displayId: relation.displayId,
                threadId: child.id,
                outcome: result.outcome,
                output,
                error: result.error,
              });
            }
            return sections;
          }),
        () =>
          SynchronizedRef.update(waitInterests, (current) =>
            adjustWaitInterests(current, childThreadIds, -1),
          ),
      );
    },
  );

  const cancel: SubagentCoordinatorShape["cancel"] = Effect.fn("SubagentCoordinator.cancel")(
    function* (parentThreadId, displayIds) {
      yield* increment(subagentCancelsTotal, { operation: "cancel" });
      const children = yield* findChildren(parentThreadId, displayIds);
      return yield* Effect.forEach(children, (child) =>
        Effect.gen(function* () {
          const relation = yield* relationFor(child.id);
          const settled = currentRunResult(child);
          if (settled && !isRunningChild(child)) {
            if (settled.state === "pending") yield* transitionResult(child, settled, "consumed");
            return { displayId: relation.displayId, cancelled: false };
          }
          yield* SynchronizedRef.update(
            cancelledStartups,
            (current) => new Set([...current, child.id]),
          );
          if (child.latestTurn?.turnId) {
            const createdAt = yield* nowIso;
            yield* engine
              .dispatch({
                type: "thread.turn.interrupt",
                commandId: yield* commandId("cancel"),
                threadId: child.id,
                turnId: child.latestTurn.turnId,
                createdAt,
              })
              .pipe(Effect.mapError((cause) => fail("cancel", cause.message)));
          } else {
            yield* providerService.stopSession({ threadId: child.id }).pipe(Effect.ignore);
          }
          const refreshed = (yield* getThread(child.id)) ?? child;
          const result = yield* settle(refreshed, "interrupted", null);
          if (result) yield* transitionResult(refreshed, result, "consumed");
          return { displayId: relation.displayId, cancelled: true };
        }),
      );
    },
  );

  const check: SubagentCoordinatorShape["check"] = Effect.fn("SubagentCoordinator.check")(
    function* (parentThreadId, displayId) {
      const child = (yield* findChildren(parentThreadId, [displayId]))[0];
      if (!child) return yield* fail("ids", `Unknown subagent IDs: ${displayId}.`);
      yield* settle(child);
      const refreshed = (yield* getThread(child.id)) ?? child;
      const summary = yield* summaryFor(refreshed);
      const now = yield* Clock.currentTimeMillis;
      const latest = truncateLatestText(latestAssistantOutput(refreshed), 2_048, 20).text;
      return {
        ...summary,
        elapsedMs: Math.max(
          0,
          (summary.settledAt ? Date.parse(summary.settledAt) : now) - Date.parse(summary.createdAt),
        ),
        latestOutput: latest,
      } satisfies SubagentCheckResult;
    },
  );

  yield* Effect.addFinalizer(() =>
    repository.listAll().pipe(
      Effect.flatMap((relations) =>
        Effect.forEach(
          relations.filter(
            (relation) => relation.lifecycle === "active" && relation.status === "running",
          ),
          (relation) =>
            providerService.stopSession({ threadId: relation.childThreadId }).pipe(Effect.ignore),
          { concurrency: 4, discard: true },
        ),
      ),
      Effect.timeout("5 seconds"),
      Effect.ignore,
    ),
  );

  return SubagentCoordinator.of({ spawn, wait, cancel, check, list });
});

export const SubagentCoordinatorLive = Layer.effect(SubagentCoordinator, make).pipe(
  Layer.provideMerge(SubagentRepositoryLive),
);

export const __testing = {
  adjustWaitInterests,
  currentRunResult,
  outputForTurn,
  pendingAttention,
  truncateLatestText,
};

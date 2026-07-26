import {
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  PositiveInt,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const SubagentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(32),
  Schema.isPattern(/^sa-[1-9][0-9]*$/),
).pipe(Schema.brand("SubagentId"));
export type SubagentId = typeof SubagentId.Type;

export const SubagentStatus = Schema.Literals(["running", "done", "error"]);
export type SubagentStatus = typeof SubagentStatus.Type;

export const SubagentOutcome = Schema.Literals(["completed", "failed", "interrupted"]);
export type SubagentOutcome = typeof SubagentOutcome.Type;

export const SubagentResultState = Schema.Literals(["pending", "consumed", "delivered"]);
export type SubagentResultState = typeof SubagentResultState.Type;

export const SubagentLifecycle = Schema.Literals(["reserved", "active", "cleanup_pending"]);
export type SubagentLifecycle = typeof SubagentLifecycle.Type;

export const SubagentContextUsage = Schema.Struct({
  usedTokens: NonNegativeInt,
  maxTokens: NonNegativeInt,
});
export type SubagentContextUsage = typeof SubagentContextUsage.Type;

export const SubagentRelation = Schema.Struct({
  childThreadId: ThreadId,
  parentThreadId: ThreadId,
  displayId: SubagentId,
  ordinal: PositiveInt,
  cwd: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  providerInstanceId: ProviderInstanceId,
  provider: ProviderDriverKind,
  model: TrimmedNonEmptyString,
  lifecycle: SubagentLifecycle,
  status: SubagentStatus,
  outcome: Schema.NullOr(SubagentOutcome),
  settledAt: Schema.NullOr(IsoDateTime),
  hasPendingApproval: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  turnCount: NonNegativeInt,
  contextUsage: Schema.NullOr(SubagentContextUsage),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
});
export type SubagentRelation = typeof SubagentRelation.Type;

export const SubagentRunResult = Schema.Struct({
  childTurnId: TurnId,
  outcome: SubagentOutcome,
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
  state: SubagentResultState,
  deliveryMessageId: MessageId,
  settledAt: IsoDateTime,
});
export type SubagentRunResult = typeof SubagentRunResult.Type;

export const SubagentSummary = Schema.Struct({
  threadId: ThreadId,
  displayId: SubagentId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  providerInstanceId: ProviderInstanceId,
  provider: ProviderDriverKind,
  model: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  status: SubagentStatus,
  outcome: Schema.NullOr(SubagentOutcome),
  createdAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime),
  turnCount: NonNegativeInt,
  contextUsage: Schema.NullOr(SubagentContextUsage),
  hasPendingApproval: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
});
export type SubagentSummary = typeof SubagentSummary.Type;

export const SubagentCounts = Schema.Struct({
  running: NonNegativeInt,
  done: NonNegativeInt,
  failed: NonNegativeInt,
  needsAttention: NonNegativeInt,
});
export type SubagentCounts = typeof SubagentCounts.Type;

export const EMPTY_SUBAGENT_COUNTS: SubagentCounts = {
  running: 0,
  done: 0,
  failed: 0,
  needsAttention: 0,
};

export const SUBAGENT_REASONING_EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const SubagentReasoningEffort = Schema.Literals(SUBAGENT_REASONING_EFFORTS);
export type SubagentReasoningEffort = typeof SubagentReasoningEffort.Type;

export const SubagentSpawnRequest = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64 * 1_024)),
  title: Schema.String.check(Schema.isMaxLength(160)),
  workingDir: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
  agent: Schema.optional(Schema.Literals(["codex", "claude"])),
  providerInstanceId: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  model: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  reasoningEffort: Schema.optional(SubagentReasoningEffort),
});
export type SubagentSpawnRequest = typeof SubagentSpawnRequest.Type;

export const SubagentSpawnMcpRequest = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64 * 1_024)),
  title: Schema.String.check(Schema.isMaxLength(160)),
  working_dir: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
  agent: Schema.optional(Schema.Literals(["codex", "claude"])),
  provider_instance_id: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  model: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  reasoning_effort: Schema.optional(SubagentReasoningEffort),
});
export type SubagentSpawnMcpRequest = typeof SubagentSpawnMcpRequest.Type;

export const SubagentSpawnResult = Schema.Struct({
  displayId: SubagentId,
  threadId: ThreadId,
  modelSelection: ModelSelection,
  cwd: TrimmedNonEmptyString,
});
export type SubagentSpawnResult = typeof SubagentSpawnResult.Type;

export const SubagentIdsRequest = Schema.Struct({
  ids: Schema.Array(SubagentId).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
export type SubagentIdsRequest = typeof SubagentIdsRequest.Type;

export const SubagentListRequest = Schema.Struct({});
export type SubagentListRequest = typeof SubagentListRequest.Type;

export const SubagentCheckRequest = Schema.Struct({ id: SubagentId });
export type SubagentCheckRequest = typeof SubagentCheckRequest.Type;

export const SubagentOutputSection = Schema.Struct({
  displayId: SubagentId,
  threadId: ThreadId,
  outcome: SubagentOutcome,
  output: Schema.String,
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
});
export type SubagentOutputSection = typeof SubagentOutputSection.Type;

export const SubagentCheckResult = SubagentSummary.pipe(
  Schema.fieldsAssign({
    elapsedMs: NonNegativeInt,
    latestOutput: Schema.String.check(Schema.isMaxLength(2_048)),
  }),
);
export type SubagentCheckResult = typeof SubagentCheckResult.Type;

export const SubagentListResult = SubagentSummary.pipe(
  Schema.fieldsAssign({ elapsedMs: NonNegativeInt }),
);
export type SubagentListResult = typeof SubagentListResult.Type;

export const SubagentCancelResult = Schema.Struct({
  displayId: SubagentId,
  cancelled: Schema.Boolean,
});
export type SubagentCancelResult = typeof SubagentCancelResult.Type;

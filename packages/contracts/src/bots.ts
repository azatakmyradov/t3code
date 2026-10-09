import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  IsoDateTime,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";

/** Longest saved note, task result, or main-conversation update. */
export const BOT_NOTES_MAX_LENGTH = 24_000;
/** Longest message in a bot transcript. */
export const BOT_MESSAGE_MAX_LENGTH = 100_000;

/** Recent task threads per bot in `bots.subscribe`, plus unfinished ones; older ones come from `bots.get`. */
export const BOT_NAVIGATION_THREAD_LIMIT = 20;

export const BotId = TrimmedNonEmptyString.pipe(Schema.brand("BotId"));
export type BotId = typeof BotId.Type;

/*
 * Bot conversation ids carry their owner, so clients can recognize any bot thread, including
 * old and remote task threads, without the server streaming every thread it has ever made.
 */
const MAIN_THREAD_SUFFIX = ":main";
const TASK_PREFIX = "bot:task:";
const TASK_THREAD_SUFFIX = ":thread";

export const botMainThreadId = (botId: BotId) => ThreadId.make(`${botId}${MAIN_THREAD_SUFFIX}`);
/** Stable per client request, so a retried start resolves to the same task. */
export const botTaskId = (botId: BotId, clientRequestId: string) =>
  `${TASK_PREFIX}${encodeURIComponent(botId)}:${encodeURIComponent(clientRequestId)}`;
export const botTaskThreadId = (taskId: string) => ThreadId.make(`${taskId}${TASK_THREAD_SUFFIX}`);

/** The bot owning a main or task conversation, read from its id. */
export function botIdForThread(threadId: string): BotId | null {
  if (threadId.startsWith("bot:profile:") && threadId.endsWith(MAIN_THREAD_SUFFIX)) {
    return BotId.make(threadId.slice(0, -MAIN_THREAD_SUFFIX.length));
  }
  if (!threadId.startsWith(TASK_PREFIX) || !threadId.endsWith(TASK_THREAD_SUFFIX)) return null;
  // Both encoded parts are free of ":", so the bot id is the first segment after the prefix.
  const encodedBotId = threadId.slice(TASK_PREFIX.length).split(":")[0];
  if (!encodedBotId) return null;
  try {
    return BotId.make(decodeURIComponent(encodedBotId));
  } catch {
    return null;
  }
}
const Notes = Schema.String.check(Schema.isMaxLength(BOT_NOTES_MAX_LENGTH));
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const BotProjectAccess = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export const BotPermissions = Schema.Struct({
  runtimeMode: RuntimeMode,
  allowDelegation: Schema.Boolean,
  allowBotRequests: Schema.Boolean,
  projects: Schema.Array(BotProjectAccess).check(Schema.isMaxLength(100)),
});
export type BotPermissions = typeof BotPermissions.Type;
export const BotSummary = Schema.Struct({
  id: BotId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  environmentId: EnvironmentId,
  projectId: ProjectId,
  threadId: ThreadId,
  modelSelection: ModelSelection,
  permissions: BotPermissions,
  paused: Schema.Boolean,
  checkInMinutes: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 10080 }))),
  revision: Revision,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BotSummary = typeof BotSummary.Type;
export const BotProfile = Schema.Struct({
  ...BotSummary.fields,
  instructions: Notes,
  memory: Notes,
});
export type BotProfile = typeof BotProfile.Type;
export const BotNavigationThread = Schema.Struct({
  botId: BotId,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
});
export type BotNavigationThread = typeof BotNavigationThread.Type;
export const BotList = Schema.Struct({
  bots: Schema.Array(BotSummary),
  threads: Schema.Array(BotNavigationThread),
});
export type BotList = typeof BotList.Type;
export const BotGetInput = Schema.Struct({ botId: BotId });
export const BotCreateInput = Schema.Struct({
  clientRequestId: TrimmedNonEmptyString,
  name: BotSummary.fields.name,
  modelSelection: ModelSelection,
  permissions: BotPermissions,
});
export type BotCreateInput = typeof BotCreateInput.Type;
export const BotUpdateInput = Schema.Struct({
  botId: BotId,
  expectedRevision: Revision,
  name: Schema.optional(BotSummary.fields.name),
  modelSelection: Schema.optional(ModelSelection),
  permissions: Schema.optional(BotPermissions),
  runtimeMode: Schema.optional(RuntimeMode),
  paused: Schema.optional(Schema.Boolean),
  checkInMinutes: Schema.optional(BotSummary.fields.checkInMinutes),
});
export type BotUpdateInput = typeof BotUpdateInput.Type;
export const BotContextWriteInput = Schema.Struct({
  botId: BotId,
  expectedRevision: Revision,
  instructions: Schema.optional(Notes),
  memory: Schema.optional(Notes),
});
export type BotContextWriteInput = typeof BotContextWriteInput.Type;
export const BotTask = Schema.Struct({
  id: TrimmedNonEmptyString,
  botId: BotId,
  environmentId: EnvironmentId,
  projectId: ProjectId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  status: Schema.Literals(["pending", "running", "completed", "failed", "cancelled"]),
  result: Schema.NullOr(Notes),
  reported: Schema.Boolean,
  createdAt: IsoDateTime,
  contextUpdate: Schema.optional(
    Schema.Struct({
      baseRevision: Revision,
      baseContext: Schema.optional(Schema.Struct({ memory: Notes, instructions: Notes })),
      memory: Notes,
      instructions: Notes,
    }),
  ),
  progress: Schema.optional(Schema.Struct({ id: TrimmedNonEmptyString, text: Notes })),
  needsAttention: Schema.optional(Schema.Boolean),
  /** The task thread's latest run; a later run, such as a follow-up, reopens a reported task. */
  runId: Schema.optional(RunId),
});
export type BotTask = typeof BotTask.Type;
export const BotMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String.check(Schema.isMaxLength(BOT_MESSAGE_MAX_LENGTH)),
  createdAt: IsoDateTime,
});
export type BotMessage = typeof BotMessage.Type;
export const BotSendInput = Schema.Struct({
  botId: BotId,
  clientRequestId: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(BOT_MESSAGE_MAX_LENGTH)),
});
export type BotSendInput = typeof BotSendInput.Type;
export const BotDetail = Schema.Struct({
  bot: BotProfile,
  tasks: Schema.Array(BotTask),
  messages: Schema.Array(BotMessage),
  needsAttention: Schema.Boolean,
  working: Schema.Boolean,
});
export type BotDetail = typeof BotDetail.Type;
export const BotTaskStartInput = Schema.Struct({
  botId: BotId,
  clientRequestId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(BOT_MESSAGE_MAX_LENGTH)),
  environmentId: Schema.optional(EnvironmentId),
  projectId: Schema.optional(ProjectId),
  modelSelection: Schema.optional(ModelSelection),
});
export type BotTaskStartInput = typeof BotTaskStartInput.Type;
export const BotTaskCancelInput = Schema.Struct({ botId: BotId, taskId: TrimmedNonEmptyString });
export const BotDeleteInput = Schema.Struct({ botId: BotId, expectedRevision: Revision });
export const BotRequestInput = Schema.Struct({
  botId: BotId,
  targetBotId: BotId,
  clientRequestId: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(BOT_NOTES_MAX_LENGTH)),
});
export type BotRequestInput = typeof BotRequestInput.Type;
export const BotReplyInput = Schema.Struct({
  botId: BotId,
  requestId: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(BOT_NOTES_MAX_LENGTH)),
});
export const BotConnection = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  baseUrl: TrimmedNonEmptyString,
});
export type BotConnection = typeof BotConnection.Type;
export const BotConnectInput = Schema.Struct({
  botId: BotId,
  environmentId: EnvironmentId,
  baseUrl: TrimmedNonEmptyString,
  credential: TrimmedNonEmptyString,
});
export type BotConnectInput = typeof BotConnectInput.Type;
export const BotDisconnectInput = Schema.Struct({ botId: BotId, environmentId: EnvironmentId });
export class BotError extends Schema.TaggedError<BotError>()("BotError", {
  code: Schema.Literals(["not_found", "conflict", "permission_denied", "paused", "unavailable"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.code) {
      case "not_found":
        return "This bot or task no longer exists.";
      case "conflict":
        return "The bot changed. Reload before saving.";
      case "permission_denied":
        return "The bot does not have permission for this action.";
      case "paused":
        return "Resume this bot before starting work.";
      case "unavailable":
        return "The bot operation could not be completed.";
    }
  }
}

export const BotRemoteTaskInput = Schema.Struct({
  bot: BotProfile,
  task: BotTask,
  text: Schema.String,
  modelSelection: ModelSelection,
});
export type BotRemoteTaskInput = typeof BotRemoteTaskInput.Type;
export const BotRemoteSyncInput = Schema.Struct({
  taskId: TrimmedNonEmptyString,
  bot: BotProfile,
  /** Cancel stops the task; release hands a reported task's thread to the destination as an ordinary thread. */
  action: Schema.Literals(["sync", "cancel", "release"]),
});
export type BotRemoteSyncInput = typeof BotRemoteSyncInput.Type;

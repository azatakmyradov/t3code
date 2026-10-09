import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as BotService from "../../../bots/BotService.ts";
import * as BotRuntime from "../../../bots/BotRuntime.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Access from "../../McpToolAccess.ts";
import { BotToolkit } from "./tools.ts";

const failure = (error: { message: string }) =>
  new OrchestratorMcpFailure({ code: "capability_denied", message: error.message });
/** The calling thread's bot, from its main conversation or one of its tasks. */
const own = Effect.gen(function* () {
  const { thread } = yield* Invocation.McpInvocationContext;
  const runtime = yield* BotRuntime.BotRuntime;
  const bot =
    thread === undefined
      ? null
      : yield* runtime.forThread(thread.threadId).pipe(Effect.mapError(failure));
  if (thread === undefined || bot === null)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "This tool needs a persistent bot conversation or task.",
    });
  return { bot, threadId: thread.threadId, service: yield* BotService.BotService };
});
/** The calling bot, for tools that act on its home server. */
const ownAtHome = Effect.gen(function* () {
  const caller = yield* own;
  const runtime = yield* BotRuntime.BotRuntime;
  if (yield* runtime.isRemoteTask(caller.threadId).pipe(Effect.mapError(failure)))
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message:
        "This task runs on a remote server and cannot reach your bot's home. Put follow-up work, bot requests, or routines in your final result for the main conversation.",
    });
  return caller;
});
export const layer = Access.toLayer(BotToolkit, {
  bot_post_update: Access.writesThreads(
    () => [undefined],
    (input) =>
      own.pipe(
        Effect.flatMap(({ bot, threadId, service }) =>
          service.postThreadUpdate(threadId, bot.id, input.clientRequestId, input.text),
        ),
        Effect.mapError(failure),
      ),
  ),
  bot_context: Access.reads(() => own.pipe(Effect.map(({ bot }) => bot))),
  bot_list: Access.reads(() =>
    BotService.BotService.pipe(
      Effect.flatMap((service) => service.list()),
      Effect.map((bots) => ({ bots })),
      Effect.mapError(failure),
    ),
  ),
  bot_remember: Access.writesThreads(
    () => [undefined],
    (input) =>
      own.pipe(
        Effect.flatMap(({ bot, threadId, service }) =>
          service.writeThreadContext(threadId, {
            botId: bot.id,
            expectedRevision: input.expectedRevision,
            memory: input.memory,
          }),
        ),
        Effect.mapError(failure),
      ),
  ),
  bot_set_instructions: Access.writesThreads(
    () => [undefined],
    (input) =>
      own.pipe(
        Effect.flatMap(({ bot, threadId, service }) =>
          service.writeThreadContext(threadId, {
            botId: bot.id,
            expectedRevision: input.expectedRevision,
            instructions: input.instructions,
          }),
        ),
        Effect.mapError(failure),
      ),
  ),
  bot_start_task: Access.writesThreads(
    () => [undefined],
    (input) =>
      ownAtHome.pipe(
        Effect.flatMap(({ bot, service }) =>
          (input.botId !== undefined && input.botId !== bot.id) ||
          (input.modelSelection !== undefined &&
            input.modelSelection.instanceId !== bot.modelSelection.instanceId &&
            !bot.permissions.allowDelegation)
            ? Effect.fail(
                new OrchestratorMcpFailure({
                  code: "capability_denied",
                  message: "Start tasks for your own bot; use bot_request to ask another bot.",
                }),
              )
            : service.startTask({ ...input, botId: bot.id }).pipe(Effect.mapError(failure)),
        ),
      ),
  ),
  bot_request: Access.writesThreads(
    () => [undefined],
    (input) =>
      ownAtHome.pipe(
        Effect.flatMap(({ bot, service }) => service.request({ ...input, botId: bot.id })),
        Effect.mapError(failure),
      ),
  ),
  bot_reply: Access.writesThreads(
    () => [undefined],
    (input) =>
      own.pipe(
        Effect.flatMap(({ bot, service }) => service.reply(bot.id, input.requestId, input.text)),
        Effect.mapError(failure),
      ),
  ),
  bot_schedule: Access.writesThreads(
    () => [undefined],
    (input) =>
      ownAtHome.pipe(
        Effect.flatMap(({ bot, service }) => service.schedule({ ...input, botId: bot.id })),
        Effect.mapError(failure),
      ),
  ),
});

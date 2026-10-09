import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as BotService from "./BotService.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "bots",
  Effect.fnUntraced(function* (handlers) {
    const bots = yield* BotService.BotService;
    return handlers
      .handle("remoteTask", ({ payload }) =>
        requireEnvironmentScope(AuthOrchestrationOperateScope).pipe(
          Effect.flatMap((principal) => bots.acceptRemoteTask(payload, principal.sessionId)),
        ),
      )
      .handle("remoteTaskSync", ({ payload }) =>
        requireEnvironmentScope(AuthOrchestrationOperateScope).pipe(
          Effect.flatMap((principal) => bots.syncRemoteTask(payload, principal.sessionId)),
        ),
      )
      .handle("remoteTaskState", ({ params }) =>
        requireEnvironmentScope(AuthOrchestrationReadScope).pipe(
          Effect.flatMap((principal) => bots.remoteTaskState(params.taskId, principal.sessionId)),
        ),
      );
  }),
);

import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  BotConnection,
  BotError,
  BotProfile,
  BotTask,
  ExecutionEnvironmentDescriptor,
  type BotId,
  type BotConnectInput,
  type BotRemoteSyncInput,
  type BotTaskStartInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as BotStore from "./BotStore.ts";

const unavailable = (cause: unknown) => new BotError({ code: "unavailable", cause });
const secretKey = (botId: BotId, environmentId: string) =>
  `bot-${encodeURIComponent(botId)}-${encodeURIComponent(environmentId)}`;

/** An existing client connection grants the home server its own remote credential. */
export class BotRemote extends Context.Service<
  BotRemote,
  {
    readonly connect: (input: BotConnectInput) => Effect.Effect<BotConnection, BotError>;
    readonly disconnect: (botId: BotId, environmentId: string) => Effect.Effect<void, BotError>;
    readonly launch: (
      bot: BotProfile,
      task: BotTask,
      input: BotTaskStartInput,
    ) => Effect.Effect<BotTask, BotError>;
    readonly read: (botId: BotId, task: BotTask) => Effect.Effect<BotTask, BotError>;
    readonly sync: (
      bot: BotProfile,
      task: BotTask,
      action?: BotRemoteSyncInput["action"],
    ) => Effect.Effect<BotTask, BotError>;
  }
>()("t3/bots/BotRemote") {}

const make = Effect.gen(function* () {
  const secrets = yield* Secrets.ServerSecretStore;
  const store = yield* BotStore.BotStore;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const request = (baseUrl: string, path: string, token?: string, body?: unknown) =>
    Effect.gen(function* () {
      const url = `${baseUrl.replace(/\/$/, "")}${path}`;
      const base =
        body === undefined
          ? HttpClientRequest.get(url)
          : yield* HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body));
      const response = yield* http.execute(
        token === undefined
          ? base
          : base.pipe(HttpClientRequest.setHeader("authorization", `Bearer ${token}`)),
      );
      return yield* response.json;
    }).pipe(Effect.timeout("30 seconds"), Effect.mapError(unavailable));
  const access = Effect.fn("BotRemote.access")(function* (botId: BotId, environmentId: string) {
    const connection = (yield* store.connections(botId)).find(
      (item) => item.environmentId === environmentId,
    );
    if (connection === undefined) return yield* new BotError({ code: "permission_denied" });
    const secret = yield* secrets
      .get(secretKey(botId, environmentId))
      .pipe(Effect.mapError(unavailable));
    if (Option.isNone(secret)) return yield* new BotError({ code: "permission_denied" });
    return { connection, token: new TextDecoder().decode(secret.value) };
  });
  /** Calls a destination's bot task endpoint with the bot's stored credential. */
  const requestTask = Effect.fn("BotRemote.requestTask")(function* (
    botId: BotId,
    task: BotTask,
    path: string,
    body?: unknown,
  ) {
    const { connection, token } = yield* access(botId, task.environmentId);
    return yield* request(connection.baseUrl, path, token, body).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(BotTask)),
      Effect.mapError(unavailable),
    );
  });
  return BotRemote.of({
    connect: Effect.fn("BotRemote.connect")(function* ({
      botId,
      environmentId,
      baseUrl: address,
      credential,
    }) {
      yield* store.get(botId);
      const baseUrl = yield* Effect.try({
        try: () => {
          const url = new URL(address);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            throw new Error("Invalid environment address");
          return url.toString().replace(/\/$/, "");
        },
        catch: unavailable,
      });
      const descriptor = yield* request(baseUrl, "/.well-known/t3/environment").pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ExecutionEnvironmentDescriptor)),
        Effect.mapError(unavailable),
      );
      if (descriptor.environmentId !== environmentId)
        return yield* new BotError({ code: "permission_denied" });
      if (descriptor.capabilities.bots !== true)
        return yield* new BotError({ code: "unavailable" });
      const token = yield* HttpClientRequest.post(`${baseUrl}/oauth/token`).pipe(
        HttpClientRequest.bodyUrlParams({
          grant_type: AuthTokenExchangeGrantType,
          subject_token: credential,
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
          client_label: `T3 bot ${botId}`,
          scope: "orchestration:read orchestration:operate",
        }),
        http.execute,
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(AuthAccessTokenResult)),
        Effect.timeout("30 seconds"),
        Effect.mapError(unavailable),
      );
      if (token.token_type !== "Bearer") return yield* new BotError({ code: "permission_denied" });
      const connection = {
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        baseUrl,
      };
      yield* secrets
        .set(
          secretKey(botId, descriptor.environmentId),
          new TextEncoder().encode(token.access_token),
        )
        .pipe(Effect.mapError(unavailable));
      yield* store.saveConnection(botId, connection);
      return connection;
    }),
    disconnect: Effect.fn("BotRemote.disconnect")(function* (botId, environmentId) {
      yield* store.removeConnection(botId, environmentId);
      yield* secrets.remove(secretKey(botId, environmentId)).pipe(Effect.mapError(unavailable));
    }),
    launch: (bot, task, input) =>
      requestTask(bot.id, task, "/api/bots/remote-task", {
        bot,
        task,
        text: input.text,
        modelSelection: input.modelSelection ?? bot.modelSelection,
      }),
    read: (botId, task) =>
      requestTask(botId, task, `/api/bots/remote-task/${encodeURIComponent(task.id)}`),
    sync: (bot, task, action = "sync") =>
      requestTask(bot.id, task, "/api/bots/remote-task-sync", { bot, taskId: task.id, action }),
  });
});
export const layer = Layer.effect(BotRemote, make);

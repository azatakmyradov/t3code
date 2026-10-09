// @effect-diagnostics nodeBuiltinImport:off - Exercise the remote protocol over a real loopback HTTP connection.
import * as NodeHttp from "node:http";
import { assert, it } from "@effect/vitest";
import {
  AuthAccessTokenType,
  BotId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type BotProfile,
  type BotTask,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as BotRemote from "./BotRemote.ts";
import * as BotStore from "./BotStore.ts";

const home = EnvironmentId.make("home");
const destination = EnvironmentId.make("remote");
const bot: BotProfile = {
  id: BotId.make("assistant"),
  name: "Assistant",
  environmentId: home,
  projectId: ProjectId.make("scratch"),
  threadId: ThreadId.make("assistant:main"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  permissions: {
    runtimeMode: "approval-required",
    allowDelegation: true,
    allowBotRequests: true,
    projects: [{ environmentId: destination, projectId: ProjectId.make("workspace") }],
  },
  paused: false,
  checkInMinutes: null,
  revision: 0,
  instructions: "Help with research.",
  memory: "Prefer short replies.",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
};
const task: BotTask = {
  id: "task:remote/research",
  botId: bot.id,
  environmentId: destination,
  projectId: ProjectId.make("workspace"),
  threadId: ThreadId.make("research"),
  title: "Research",
  status: "running",
  result: null,
  reported: false,
  createdAt: bot.createdAt,
};

function fixture(supportsBots = true) {
  const requests: { url: string; authorization: string | undefined; body: string }[] = [];
  let rejectSession = false;
  const server = NodeHttp.createServer((request, response) => {
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = request.url ?? "";
      requests.push({ url, authorization: request.headers.authorization, body });
      response.setHeader("content-type", "application/json");
      if (url === "/.well-known/t3/environment") {
        response.end(
          JSON.stringify({
            environmentId: destination,
            label: "Remote workspace",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "test",
            capabilities: { bots: supportsBots },
          }),
        );
      } else if (url === "/oauth/token") {
        response.end(
          JSON.stringify({
            access_token: "test-session",
            issued_token_type: AuthAccessTokenType,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "orchestration:read orchestration:operate",
          }),
        );
      } else if (rejectSession || request.headers.authorization !== "Bearer test-session") {
        response.writeHead(401).end("{}");
      } else {
        response.end(
          JSON.stringify(
            url.endsWith("remote-task-sync")
              ? { ...task, status: "cancelled" }
              : url.startsWith("/api/bots/remote-task/")
                ? {
                    ...task,
                    status: "completed",
                    result: "Answer",
                    contextUpdate: {
                      baseRevision: 0,
                      instructions: bot.instructions,
                      memory: "New fact",
                    },
                  }
                : task,
          ),
        );
      }
    });
  });
  return {
    requests,
    rejectSession: () => {
      rejectSession = true;
    },
    open: Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<string>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (address === null || typeof address === "string")
                throw new Error("Missing HTTP address");
              resolve(`http://127.0.0.1:${address.port}`);
            });
          }),
      ),
      () =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections();
            }),
        ),
    ),
  };
}

function layer() {
  const secrets = new Map<string, Uint8Array>();
  return BotRemote.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        BotStore.layer.pipe(Layer.provide(Sqlite.layerMemory)),
        FetchHttpClient.layer,
        Layer.mock(Secrets.ServerSecretStore)({
          get: (key) => Effect.succeed(Option.fromUndefinedOr(secrets.get(key))),
          set: (key, value) =>
            Effect.sync(() => {
              secrets.set(key, value);
            }),
          remove: (key) =>
            Effect.sync(() => {
              secrets.delete(key);
            }),
        }),
      ),
    ),
  );
}

it.effect(
  "grants access, launches, reads saved notes, cancels, and removes remote access over HTTP",
  () => {
    const remote = fixture();
    return Effect.gen(function* () {
      const origin = yield* remote.open;
      const store = yield* BotStore.BotStore;
      const service = yield* BotRemote.BotRemote;
      yield* store.save(bot);
      const connection = yield* service.connect({
        botId: bot.id,
        environmentId: destination,
        baseUrl: origin,
        credential: "TESTPAIR",
      });
      assert.equal(connection.environmentId, destination);
      const exchange = new URLSearchParams(remote.requests[1]?.body);
      assert.equal(exchange.get("subject_token"), "TESTPAIR");
      assert.equal(exchange.get("client_label"), `T3 bot ${bot.id}`);
      assert.equal(exchange.get("scope"), "orchestration:read orchestration:operate");
      yield* service.launch(bot, task, {
        botId: bot.id,
        clientRequestId: "job",
        title: task.title,
        text: "Research this",
      });
      const launch = JSON.parse(remote.requests[2]?.body ?? "{}");
      assert.deepEqual(launch.bot, bot);
      assert.equal(launch.text, "Research this");
      assert.deepEqual(launch.modelSelection, bot.modelSelection);
      const finished = yield* service.read(bot.id, task);
      assert.equal(finished.result, "Answer");
      assert.equal(finished.contextUpdate?.memory, "New fact");
      assert.equal(remote.requests[3]?.url, `/api/bots/remote-task/${encodeURIComponent(task.id)}`);
      assert.equal(
        (yield* service.sync({ ...bot, paused: true }, task, "cancel")).status,
        "cancelled",
      );
      assert.equal(JSON.parse(remote.requests[4]?.body ?? "{}").action, "cancel");
      remote.rejectSession();
      assert.equal((yield* service.read(bot.id, task).pipe(Effect.flip)).code, "unavailable");
      yield* service.disconnect(bot.id, destination);
      assert.deepEqual(yield* store.connections(bot.id), []);
      assert.equal((yield* service.read(bot.id, task).pipe(Effect.flip)).code, "permission_denied");
    }).pipe(Effect.scoped, Effect.provide(layer()));
  },
);

it.effect("does not consume a pairing token on a server without Bots", () => {
  const remote = fixture(false);
  return Effect.gen(function* () {
    const origin = yield* remote.open;
    const store = yield* BotStore.BotStore;
    const service = yield* BotRemote.BotRemote;
    yield* store.save(bot);
    assert.equal(
      (yield* service
        .connect({
          botId: bot.id,
          environmentId: destination,
          baseUrl: origin,
          credential: "TESTPAIR",
        })
        .pipe(Effect.flip)).code,
      "unavailable",
    );
    assert.equal(remote.requests.length, 1);
    assert.deepEqual(yield* store.connections(bot.id), []);
  }).pipe(Effect.scoped, Effect.provide(layer()));
});

it.effect("rejects a different environment before exchanging or saving the credential", () => {
  const remote = fixture();
  return Effect.gen(function* () {
    const origin = yield* remote.open;
    const store = yield* BotStore.BotStore;
    const service = yield* BotRemote.BotRemote;
    yield* store.save(bot);
    const error = yield* service
      .connect({
        botId: bot.id,
        environmentId: EnvironmentId.make("wrong-destination"),
        baseUrl: origin,
        credential: "TESTPAIR",
      })
      .pipe(Effect.flip);
    assert.equal(error.code, "permission_denied");
    assert.equal(remote.requests.length, 1);
    assert.deepEqual(yield* store.connections(bot.id), []);
  }).pipe(Effect.scoped, Effect.provide(layer()));
});

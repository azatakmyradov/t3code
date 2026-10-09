import { assert, it } from "@effect/vitest";
import { BotId, EnvironmentId, WS_METHODS, type BotConnectInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
} from "../connection/model.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import * as Registry from "../connection/registry.ts";
import * as Supervisor from "../connection/supervisor.ts";
import type { RpcSession } from "./session.ts";
import { RpcPermissionGuard } from "./client.ts";
import { connectBotEnvironment } from "./botConnections.ts";

const home = EnvironmentId.make("home");
const destination = EnvironmentId.make("destination");
const botId = BotId.make("assistant");
const target = new BearerConnectionTarget({
  environmentId: destination,
  label: "Destination",
  connectionId: "saved",
});

it.effect("issues a scoped background grant through the saved bearer connection", () =>
  scenario({ _tag: "Bearer", token: "client-session" }, false),
);
it.effect("issues a scoped background grant through the saved cookie connection", () =>
  scenario(null, false),
);
it.effect("does not contact the home server when the destination denies credential issuance", () =>
  scenario({ _tag: "Bearer", token: "client-session" }, true),
);

function scenario(authorization: PreparedConnection["httpAuthorization"], denied: boolean) {
  return Effect.gen(function* () {
    const prepared: PreparedConnection = {
      environmentId: destination,
      label: "Destination",
      httpBaseUrl: "https://destination.test",
      socketUrl: "wss://destination.test/ws",
      httpAuthorization: authorization,
      target,
    };
    const remote = yield* Supervisor.EnvironmentSupervisor.pipe(
      Effect.provide(
        Layer.mock(Supervisor.EnvironmentSupervisor)({
          prepared: yield* SubscriptionRef.make(Option.some(prepared)),
          target,
          state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        }),
      ),
    );
    const sent: BotConnectInput[] = [];
    const homeSupervisor = Layer.mock(Supervisor.EnvironmentSupervisor)({
      state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      target: new BearerConnectionTarget({
        environmentId: home,
        label: "Home",
        connectionId: "home",
      }),
      session: yield* SubscriptionRef.make(
        Option.some({
          client: {
            [WS_METHODS.botsConnect]: (input: BotConnectInput) =>
              Effect.sync(() => {
                sent.push(input);
                return { environmentId: destination, label: "Destination", baseUrl: input.baseUrl };
              }),
          },
        } as unknown as RpcSession),
      ),
    });
    let requests = 0;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      requests++;
      assert.equal(String(url), "https://destination.test/api/auth/pairing-token");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        authorization ? "Bearer client-session" : null,
      );
      if (authorization === null) assert.equal(init?.credentials, "include");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        label: `T3 bot ${botId}`,
        scopes: ["orchestration:read", "orchestration:operate"],
      });
      return denied
        ? Response.json(
            {
              _tag: "EnvironmentScopeRequiredError",
              code: "insufficient_scope",
              requiredScope: "access:write",
              traceId: "test",
            },
            { status: 403 },
          )
        : Response.json({
            id: "credential",
            credential: "background-bootstrap",
            expiresAt: "2026-10-09T12:00:00.000Z",
          });
    };
    const operation = connectBotEnvironment({ botId, remoteEnvironmentId: destination }).pipe(
      Effect.provide(
        Layer.merge(
          homeSupervisor,
          Layer.mock(Registry.EnvironmentRegistry)({
            entries: yield* SubscriptionRef.make<
              ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
            >(new Map()),
            networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
            run: (id, effect) => {
              assert.equal(id, destination);
              return effect.pipe(Effect.provideService(Supervisor.EnvironmentSupervisor, remote));
            },
          }),
        ),
      ),
      Effect.provideService(RpcPermissionGuard, { authorize: () => Effect.void }),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
    if (denied) {
      const error = yield* operation.pipe(Effect.flip);
      if (error._tag !== "BotError") throw new Error("Expected destination denial");
      assert.equal(error.code, "permission_denied");
      assert.deepEqual(sent, []);
    } else {
      assert.equal((yield* operation).environmentId, destination);
      assert.deepEqual(sent, [
        {
          botId,
          environmentId: destination,
          baseUrl: prepared.httpBaseUrl,
          credential: "background-bootstrap",
        },
      ]);
    }
    assert.equal(requests, 1);
  });
}

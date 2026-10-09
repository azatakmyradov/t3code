import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  BotError,
  WS_METHODS,
  type BotId,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as RemoteAuthorization from "../authorization/service.ts";
import * as Registry from "../connection/registry.ts";
import * as Supervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "../state/environmentHttpAuth.ts";
import { requestGuarded } from "./client.ts";

const isBotError = Schema.is(BotError);

/** Authorize through the selected connection; never copy the client's session token. */
export const connectBotEnvironment = Effect.fn("connectBotEnvironment")(function* (input: {
  readonly botId: BotId;
  readonly remoteEnvironmentId: EnvironmentId;
}) {
  const registry = yield* Registry.EnvironmentRegistry;
  const grant = yield* registry
    .run(
      input.remoteEnvironmentId,
      Effect.gen(function* () {
        const supervisor = yield* Supervisor.EnvironmentSupervisor;
        const prepared = yield* SubscriptionRef.get(supervisor.prepared);
        if (Option.isNone(prepared)) return yield* new BotError({ code: "unavailable" });
        const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
        const remoteAuthorization = yield* Effect.serviceOption(
          RemoteAuthorization.RemoteEnvironmentAuthorization,
        );
        let baseUrl = prepared.value.httpBaseUrl;
        const issued = yield* executeAuthenticatedEnvironmentHttpRequest({
          prepared: prepared.value,
          signer,
          remoteAuthorization,
          group: "auth",
          method: "POST",
          url: (origin) => {
            baseUrl = origin;
            return `${origin.replace(/\/$/, "")}/api/auth/pairing-token`;
          },
          timeoutMs: 30_000,
          request: ({ client, headers }) =>
            client.pairingCredential({
              headers,
              payload: {
                label: `T3 bot ${input.botId}`,
                scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
              },
            }),
        });
        return { baseUrl, credential: issued.credential };
      }),
    )
    .pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.mapError((cause) =>
        isBotError(cause) ? cause : new BotError({ code: "permission_denied", cause }),
      ),
    );
  return yield* requestGuarded(WS_METHODS.botsConnect, {
    botId: input.botId,
    environmentId: input.remoteEnvironmentId,
    ...grant,
  });
});

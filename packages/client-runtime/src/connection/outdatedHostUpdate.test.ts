import { forkReleaseForVersion } from "@t3tools/shared/releaseCompatibility";
import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  ExecutionEnvironmentDescriptor,
  WS_METHODS,
  type ServerSelfUpdateResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import { orchestrationProtocolCompatibilityError } from "./compatibility.ts";
import { PrimaryConnectionTarget } from "./model.ts";
import { updateOutdatedHost } from "./outdatedHostUpdate.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as ConnectionResolver from "./resolver.ts";
import * as RelayEnvironmentDiscovery from "../relay/discovery.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-old"),
  label: "Build Mac",
  httpBaseUrl: "https://build.example.test",
  wsBaseUrl: "wss://build.example.test",
});

const descriptor = (protocol: number | undefined, serverVersion: string) =>
  ({
    environmentId: TARGET.environmentId,
    label: TARGET.label,
    platform: { os: "darwin", arch: "arm64" },
    serverVersion,
    release: forkReleaseForVersion(serverVersion),
    ...(protocol === undefined ? {} : { orchestrationProtocolVersion: protocol }),
    capabilities: { repositoryIdentity: true, serverSelfUpdate: "boot-service" },
  }) satisfies ExecutionEnvironmentDescriptor;

const RpcRequest = Schema.TaggedStruct("Request", {
  id: Schema.Union([Schema.String, Schema.Number]),
  payload: Schema.Unknown,
  tag: Schema.String,
});
const isRpcRequest = Schema.is(RpcRequest);
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeDescriptor = Schema.encodeSync(Schema.fromJsonString(ExecutionEnvironmentDescriptor));

type Listener = (event: { readonly type: string; readonly data?: unknown }) => void;

class OutdatedHostSocket {
  static readonly OPEN = 1;
  readyState = 0;
  readonly requests: Array<typeof RpcRequest.Type> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  readonly url: string;
  private readonly onUpdate: () => void;
  private readonly result: ServerSelfUpdateResult;

  constructor(
    url: string,
    onUpdate: () => void,
    result: ServerSelfUpdateResult = {
      targetVersion: "0.0.46",
      method: "boot-service",
      updateId: "update-1",
    },
  ) {
    this.url = url;
    this.onUpdate = onUpdate;
    this.result = result;
    queueMicrotask(() => {
      this.readyState = OutdatedHostSocket.OPEN;
      this.emit({ type: "open" });
    });
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    const message = decodeJson(data);
    if (!isRpcRequest(message)) return;
    this.requests.push(message);
    if (
      message.tag !== WS_METHODS.serverUpdateServer &&
      message.tag !== WS_METHODS.serverUpdateServerWithProgress
    )
      return;
    this.onUpdate();
    queueMicrotask(() => {
      if (message.tag === WS_METHODS.serverUpdateServerWithProgress) {
        this.emit({
          type: "message",
          data: encodeJson({
            _tag: "Chunk",
            requestId: message.id,
            values: [{ type: "complete", result: this.result }],
          }),
        });
      }
      this.emit({
        type: "message",
        data: encodeJson({
          _tag: "Exit",
          requestId: message.id,
          exit: {
            _tag: "Success",
            value: message.tag === WS_METHODS.serverUpdateServerWithProgress ? null : this.result,
          },
        }),
      });
    });
  }

  close() {
    this.readyState = 3;
    this.emit({ type: "close" });
  }

  private emit(event: { readonly type: string; readonly data?: unknown }) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

describe("updateOutdatedHost", () => {
  it.effect.each(["updated", "up-to-date", "stream-up-to-date"] as const)(
    "handles %s on a protocol-1 host without claiming a nonexistent restart",
    (outcome) =>
      Effect.gen(function* () {
        const blocked = orchestrationProtocolCompatibilityError(descriptor(undefined, "0.0.45"));
        expect(blocked).toMatchObject({ serverUpdateRequired: true });

        const sockets: Array<OutdatedHostSocket> = [];
        let served: ExecutionEnvironmentDescriptor = {
          ...descriptor(undefined, "0.0.45"),
          capabilities: {
            repositoryIdentity: true,
            serverSelfUpdate: "desktop-managed",
            desktopAppUpdate: true,
            serverSelfUpdateProgress: outcome === "stream-up-to-date",
          },
        };
        const stages: string[] = [];
        let descriptorPolls = 0;
        const entries = yield* SubscriptionRef.make<
          ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
        >(
          new Map([
            [
              TARGET.environmentId,
              {
                target: TARGET,
                profile: Option.none(),
                enabled: false,
                unsupportedReason: blocked?.message ?? "",
                serverUpdateRequired: true,
              },
            ],
          ]),
        );
        const calls: Array<string> = [];
        const registry = EnvironmentRegistry.EnvironmentRegistry.of({
          entries,
          setCompatibility: (_environmentId: EnvironmentId, error: unknown) =>
            Effect.sync(() => calls.push(`compatibility:${error === null ? "clear" : "block"}`)),
          setEnabled: (_environmentId: EnvironmentId, enabled: boolean) =>
            Effect.sync(() => calls.push(`enabled:${enabled}`)),
        } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
        const resolver = ConnectionResolver.ConnectionResolver.of({
          prepare: () => Effect.die(new Error("The update must bypass the protocol gate.")),
          prepareForUpdate: () =>
            Effect.sync(() => served).pipe(
              Effect.map((current) => ({
                descriptor: current,
                prepared: {
                  environmentId: TARGET.environmentId,
                  label: TARGET.label,
                  httpBaseUrl: TARGET.httpBaseUrl,
                  socketUrl: "wss://build.example.test/ws?wsTicket=ticket",
                  httpAuthorization: null,
                  target: TARGET,
                },
              })),
            ),
        });
        const httpClient = HttpClient.make((request) =>
          Effect.sync(() => {
            descriptorPolls++;
            return HttpClientResponse.fromWeb(request, new Response(encodeDescriptor(served)));
          }),
        );

        const result = yield* updateOutdatedHost(
          TARGET.environmentId,
          { targetVersion: "0.0.46" },
          (stage) =>
            Effect.sync(() => {
              stages.push(stage);
            }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry),
              Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
              Layer.succeed(
                RelayEnvironmentDiscovery.RelayEnvironmentDiscovery,
                RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.of({
                  state: yield* SubscriptionRef.make(
                    RelayEnvironmentDiscovery.EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
                  ),
                  refresh: Effect.void,
                }),
              ),
              Layer.succeed(HttpClient.HttpClient, httpClient),
              Layer.succeed(Socket.WebSocketConstructor, (url) => {
                // The host relaunches on a compatible protocol once the update lands.
                const socket = new OutdatedHostSocket(
                  url,
                  () => {
                    if (outcome === "updated")
                      served = descriptor(ORCHESTRATION_PROTOCOL_VERSION, "0.0.46");
                  },
                  outcome === "updated"
                    ? { targetVersion: "0.0.46", method: "boot-service", updateId: "update-1" }
                    : {
                        targetVersion: "0.0.45",
                        method: "desktop-app",
                        outcome: "up-to-date",
                        desktopUpdateToken: "must-not-commit",
                      },
                );
                sockets.push(socket);
                return socket as unknown as globalThis.WebSocket;
              }),
            ),
          ),
        );

        expect(sockets[0]?.url).not.toContain("orchestrationProtocol");
        expect(sockets[0]?.requests.map((request) => request.tag)).toEqual([
          outcome === "stream-up-to-date"
            ? WS_METHODS.serverUpdateServerWithProgress
            : WS_METHODS.serverUpdateServer,
        ]);
        expect(sockets[0]?.requests[0]?.payload).toMatchObject({ reportUpToDate: true });
        if (outcome === "updated") {
          expect(result.targetVersion).toBe("0.0.46");
          expect(calls).toEqual(["compatibility:clear", "enabled:true"]);
          expect(stages).toContain("resuming");
          expect(descriptorPolls).toBeGreaterThan(0);
        } else {
          expect(result).toMatchObject({ outcome: "up-to-date", targetVersion: "0.0.45" });
          expect(calls).toEqual([]);
          expect(stages).not.toContain("resuming");
          expect(descriptorPolls).toBe(0);
        }
      }),
  );

  it.effect.each(["manual", "unknown", "foreign", "other-channel"] as const)(
    "refuses a %s host without opening an update socket",
    (kind) =>
      Effect.gen(function* () {
        const base = descriptor(undefined, "0.0.45");
        const { release: _release, ...withoutRelease } = base;
        const manual: ExecutionEnvironmentDescriptor =
          kind === "manual"
            ? { ...base, capabilities: { repositoryIdentity: true } }
            : kind === "unknown"
              ? withoutRelease
              : {
                  ...base,
                  release:
                    kind === "foreign"
                      ? { distribution: "pingdotgg/t3code", channel: "stable" }
                      : forkReleaseForVersion("0.0.45-nightly.20261001.1"),
                };

        let opened = false;
        const error = yield* Effect.flip(
          updateOutdatedHost(TARGET.environmentId, { targetVersion: "0.0.46" }, () => Effect.void),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(
                EnvironmentRegistry.EnvironmentRegistry,
                EnvironmentRegistry.EnvironmentRegistry.of({
                  entries: yield* SubscriptionRef.make<
                    ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
                  >(
                    new Map([
                      [
                        TARGET.environmentId,
                        { target: TARGET, profile: Option.none(), enabled: false },
                      ],
                    ]),
                  ),
                } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
              ),
              Layer.succeed(
                ConnectionResolver.ConnectionResolver,
                ConnectionResolver.ConnectionResolver.of({
                  prepare: () => Effect.die(new Error("unused")),
                  prepareForUpdate: () =>
                    Effect.succeed({
                      descriptor: manual,
                      prepared: {
                        environmentId: TARGET.environmentId,
                        label: TARGET.label,
                        httpBaseUrl: TARGET.httpBaseUrl,
                        socketUrl: "wss://build.example.test/ws",
                        httpAuthorization: null,
                        target: TARGET,
                      },
                    }),
                }),
              ),
              Layer.succeed(
                RelayEnvironmentDiscovery.RelayEnvironmentDiscovery,
                RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.of({
                  state: yield* SubscriptionRef.make(
                    RelayEnvironmentDiscovery.EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
                  ),
                  refresh: Effect.void,
                }),
              ),
              Layer.succeed(
                HttpClient.HttpClient,
                HttpClient.make(() => Effect.die(new Error("unused"))),
              ),
              Layer.succeed(Socket.WebSocketConstructor, () => {
                opened = true;
                throw new Error("unused");
              }),
            ),
          ),
        );
        expect(error).toMatchObject({ _tag: "OutdatedHostUpdateError" });
        expect(opened).toBe(false);
      }),
  );
});

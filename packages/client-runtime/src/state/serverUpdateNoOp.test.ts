import {
  EnvironmentId,
  ServerSelfUpdateError,
  WS_METHODS,
  type ServerConfig,
  type ServerSelfUpdateInput,
  type ServerSelfUpdateResult,
  type ServerRelease,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createServerEnvironmentAtoms } from "./server.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("update-environment"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const NO_UPDATE = {
  targetVersion: "1.2.0",
  method: "desktop-app",
  outcome: "up-to-date",
} as const;

const makeHarness = Effect.fn("ServerUpdateNoOpTest.makeHarness")(function* (
  supportsProgress: boolean,
  update: Effect.Effect<ServerSelfUpdateResult, ServerSelfUpdateError>,
  desktopManaged = true,
  release: ServerRelease | null = { distribution: "azatakmyradov/t3code", channel: "stable" },
  sessionRelease: ServerRelease | null = release,
) {
  const config = {
    environment: {
      serverVersion: "1.2.0",
      ...(release === null ? {} : { release }),
      capabilities: {
        serverSelfUpdate: desktopManaged ? "desktop-managed" : "boot-service",
        serverSelfUpdateProgress: supportsProgress,
      },
    },
  } as ServerConfig;
  const requests: ServerSelfUpdateInput[] = [];
  let commits = 0;
  let lifecycleSubscriptions = 0;
  let reconnects = 0;
  const requestUpdate = (input: ServerSelfUpdateInput) => {
    requests.push(input);
    return update;
  };
  const client = {
    [WS_METHODS.serverUpdateServer]: requestUpdate,
    [WS_METHODS.serverUpdateServerWithProgress]: (input: ServerSelfUpdateInput) =>
      Stream.fromEffect(requestUpdate(input)).pipe(
        Stream.map((result) => ({ type: "complete" as const, result })),
      ),
    [WS_METHODS.serverCommitDesktopUpdate]: () => {
      commits += 1;
      return Effect.die("A no-op must not commit an update");
    },
    [WS_METHODS.subscribeServerConfig]: () => Stream.never,
    [WS_METHODS.subscribeServerLifecycle]: () => {
      lifecycleSubscriptions += 1;
      return Stream.die("A no-op must not wait for a restart");
    },
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    inboundFrames: Effect.succeed(0),
    client,
    initialConfig: Effect.succeed({
      ...config,
      environment: {
        ...config.environment,
        release: sessionRelease ?? undefined,
      },
    } as ServerConfig),
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected",
    }),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const unexpected = () => Effect.die("Unexpected environment mutation in update test");
  const environments = EnvironmentRegistry.EnvironmentRegistry.of({
    entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
      new Map(),
    ),
    networkStatus: yield* SubscriptionRef.make<"online" | "offline" | "unknown">("online"),
    start: Effect.void,
    register: unexpected,
    assertKnownAddress: unexpected,
    reconcilePlatform: unexpected,
    remove: unexpected,
    removeRoute: unexpected,
    reorderRoutes: unexpected,
    removeRelayEnvironments: unexpected,
    setEnabled: unexpected,
    setCompatibility: unexpected,
    state: () => SubscriptionRef.get(supervisor.state),
    run: (_id, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    runStream: (_id, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    followStream: (_id, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    stateChanges: () =>
      Stream.suspend(() => {
        reconnects += 1;
        return Stream.empty;
      }),
    retryNow: () => Effect.void,
  });
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeedNone,
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
  });
  const runtime = Atom.runtime(
    Layer.merge(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
      Layer.succeed(Persistence.EnvironmentCacheStore, cache),
    ),
  );
  const configAtom = Atom.make(config);
  const atoms = createServerEnvironmentAtoms(runtime, { initialConfigValueAtom: () => configAtom });
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  return {
    run: () =>
      Effect.promise(() =>
        atoms.updateServer.run(registry, {
          environmentId: TARGET.environmentId,
          input: { targetVersion: "1.3.0" },
        }),
      ),
    state: () => registry.get(atoms.updateStateAtom(TARGET.environmentId)),
    requests,
    effects: () => ({ commits, lifecycleSubscriptions, reconnects }),
  };
});

const noopCases = [false, true].flatMap((supportsProgress) =>
  [false, true].map((legacy) => ({ supportsProgress, legacy })),
);
it.effect.each(noopCases)(
  "completes no-op without restarting (stream: $supportsProgress, legacy: $legacy)",
  ({ supportsProgress, legacy }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness(
          supportsProgress,
          legacy
            ? Effect.fail(
                new ServerSelfUpdateError({
                  reason: "The T3 Code desktop app on this machine is already up to date on 1.2.0.",
                }),
              )
            : Effect.succeed(NO_UPDATE),
        );
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = yield* harness.run();
          expect(AsyncResult.isSuccess(result) && result.value).toEqual(NO_UPDATE);
          expect(harness.state()).toEqual({ status: "idle" });
        }
        expect(harness.requests).toEqual([
          { targetVersion: "1.3.0", reportUpToDate: true },
          { targetVersion: "1.3.0", reportUpToDate: true },
        ]);
        expect(harness.effects()).toEqual({ commits: 0, lifecycleSubscriptions: 0, reconnects: 0 });
      }),
    ),
);
const errorCases = [false, true].flatMap((supportsProgress) =>
  [
    ["feed unreachable", true],
    ["The T3 Code desktop app on this machine is already up to date on 1.1.0.", true],
    ["The T3 Code desktop app on this machine is already up to date on 1.2.0.", false],
    [
      "The T3 Code desktop app on this machine is already up to date on 1.2.0. Installation failed.",
      true,
    ],
  ].map(([reason, desktopManaged]) => ({
    supportsProgress,
    reason: String(reason),
    desktopManaged: Boolean(desktopManaged),
  })),
);
it.effect.each(errorCases)(
  "preserves real or mismatched errors ($supportsProgress, $desktopManaged, $reason)",
  ({ supportsProgress, reason, desktopManaged }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness(
          supportsProgress,
          Effect.fail(new ServerSelfUpdateError({ reason })),
          desktopManaged,
        );
        expect(AsyncResult.isFailure(yield* harness.run())).toBe(true);
        expect(harness.state()).toMatchObject({
          status: "failed",
          message: `Server update failed: ${reason}`,
        });
        expect(harness.effects()).toEqual({ commits: 0, lifecycleSubscriptions: 0, reconnects: 0 });
      }),
    ),
);
it.effect.each([
  null,
  { distribution: "pingdotgg/t3code", channel: "stable" },
  { distribution: "azatakmyradov/t3code", channel: "nightly" },
] as const)("does not dispatch an exact target to an incompatible host (%j)", (release) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness(true, Effect.succeed(NO_UPDATE), true, release);
      expect(AsyncResult.isFailure(yield* harness.run())).toBe(true);
      expect(harness.requests).toEqual([]);
      expect(harness.state()).toMatchObject({
        status: "failed",
        message: expect.stringContaining("server's own installation"),
      });
      expect(harness.effects()).toEqual({ commits: 0, lifecycleSubscriptions: 0, reconnects: 0 });
    }),
  ),
);
it.effect.each([false, true])(
  "revalidates the dispatch session after a same-version host replacement (%s)",
  (supportsProgress) =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness(
          supportsProgress,
          Effect.succeed(NO_UPDATE),
          true,
          { distribution: "azatakmyradov/t3code", channel: "stable" },
          { distribution: "pingdotgg/t3code", channel: "stable" },
        );
        expect(AsyncResult.isFailure(yield* harness.run())).toBe(true);
        expect(harness.requests).toEqual([]);
        expect(harness.effects()).toEqual({ commits: 0, lifecycleSubscriptions: 0, reconnects: 0 });
      }),
    ),
);

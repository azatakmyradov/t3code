// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as RelayClient from "@t3tools/shared/relayClient";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeCli } from "../binCli.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import {
  acquireRelayClientForLink,
  headlessSessionConfig,
  reportCloudDisconnectResults,
} from "./connect.ts";

const readHeadlessSessionConfig = (env: Record<string, string>) =>
  headlessSessionConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

const managedExecutable = {
  status: "available",
  executablePath: "/tmp/cloudflared",
  source: "managed",
  version: RelayClient.CLOUDFLARED_VERSION,
} as const;

it.effect("detects headless operation from individual SSH config values", () =>
  Effect.gen(function* () {
    assert.isFalse(yield* readHeadlessSessionConfig({}));
    assert.isFalse(yield* readHeadlessSessionConfig({ CI: "true" }));
    assert.isTrue(yield* readHeadlessSessionConfig({ SSH_CONNECTION: "client server" }));
    assert.isTrue(yield* readHeadlessSessionConfig({ SSH_TTY: "/dev/pts/1" }));
  }),
);

it.effect("does not install the relay client when the user declines the managed download", () =>
  Effect.gen(function* () {
    let installCalls = 0;
    const result = yield* acquireRelayClientForLink(
      {
        resolve: Effect.succeed({
          status: "missing",
          version: RelayClient.CLOUDFLARED_VERSION,
        }),
        install: Effect.sync(() => {
          installCalls += 1;
          return managedExecutable;
        }),
        installWithProgress: () =>
          Effect.sync(() => {
            installCalls += 1;
            return managedExecutable;
          }),
        pruneManagedVersions: Effect.void,
      },
      () => Effect.succeed(false),
      () => Effect.void,
    );

    assert.isTrue(Option.isNone(result));
    assert.equal(installCalls, 0);
  }),
);

it.effect("installs the relay client after the user accepts the managed download", () =>
  Effect.gen(function* () {
    let installCalls = 0;
    const progress: Array<string> = [];
    const result = yield* acquireRelayClientForLink(
      {
        resolve: Effect.succeed({
          status: "missing",
          version: RelayClient.CLOUDFLARED_VERSION,
        }),
        install: Effect.sync(() => {
          installCalls += 1;
          return managedExecutable;
        }),
        installWithProgress: (report) =>
          report({ type: "progress", stage: "downloading" }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                installCalls += 1;
                return managedExecutable;
              }),
            ),
          ),
        pruneManagedVersions: Effect.void,
      },
      () => Effect.succeed(true),
      (event) =>
        Effect.sync(() => {
          if (event.type === "progress") {
            progress.push(event.stage);
          }
        }),
    );

    assert.deepEqual(Option.getOrThrow(result), managedExecutable);
    assert.equal(installCalls, 1);
    assert.deepEqual(progress, ["downloading"]);
  }),
);

it.effect("reuses an available relay client executable without prompting", () =>
  Effect.gen(function* () {
    let promptCalls = 0;
    const result = yield* acquireRelayClientForLink(
      {
        resolve: Effect.succeed(managedExecutable),
        install: Effect.die("unexpected install"),
        installWithProgress: () => Effect.die("unexpected install"),
        pruneManagedVersions: Effect.void,
      },
      () =>
        Effect.sync(() => {
          promptCalls += 1;
          return false;
        }),
      () => Effect.void,
    );

    assert.deepEqual(Option.getOrThrow(result), managedExecutable);
    assert.equal(promptCalls, 0);
  }),
);

it.effect("keeps disconnect causes in structured logs and out of console warnings", () => {
  const warnings: ReadonlyArray<unknown>[] = [];
  const logs: Readonly<Record<string, unknown>>[] = [];
  const testConsole = {
    ...globalThis.console,
    warn: (...args: ReadonlyArray<unknown>) => {
      warnings.push(args);
    },
  } satisfies Console.Console;
  const logger = Logger.make(({ fiber }) => {
    logs.push(fiber.getRef(References.CurrentLogAnnotations));
  });
  const liveFailure = "live unlink private diagnostic";
  const relayFailure = "relay revoke private diagnostic";

  return reportCloudDisconnectResults({
    clearAuthorization: true,
    liveResult: {
      status: "failed",
      cause: Cause.fail(new Error(liveFailure)),
    },
    relayResult: Exit.failCause(Cause.die(new Error(relayFailure))),
  }).pipe(
    Effect.provideService(Console.Console, testConsole),
    Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    Effect.tap(() =>
      Effect.sync(() => {
        assert.lengthOf(warnings, 2);
        const warningText = warnings.flat().map(String).join("\n");
        assert.include(warningText, "running server could not stop its tunnel");
        assert.include(warningText, "Could not revoke the relay-side environment record");
        assert.notInclude(warningText, liveFailure);
        assert.notInclude(warningText, relayFailure);
        assert.deepEqual(
          logs.map(({ operation, clearAuthorization }) => ({ operation, clearAuthorization })),
          [
            { operation: "live-server-unlink", clearAuthorization: true },
            { operation: "relay-environment-unlink", clearAuthorization: true },
          ],
        );
        const loggedCauses = logs.map((log) => String(log.cause)).join("\n");
        assert.include(loggedCauses, liveFailure);
        assert.include(loggedCauses, relayFailure);
      }),
    ),
  );
});

/** Captures console lines from a successful local disconnect report. */
const captureDisconnectReport = (input: {
  readonly clearAuthorization: boolean;
  readonly liveResult: {
    readonly status: "succeeded";
  };
  readonly relayResult: Exit.Exit<
    { readonly status: "not-authenticated" } | { readonly status: "revoked" },
    unknown
  >;
}) => {
  const lines: Array<{ readonly stream: "log" | "warn"; readonly text: string }> = [];
  const testConsole = {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      lines.push({ stream: "log", text: args.map(String).join(" ") });
    },
    warn: (...args: ReadonlyArray<unknown>) => {
      lines.push({ stream: "warn", text: args.map(String).join(" ") });
    },
  } satisfies Console.Console;

  return reportCloudDisconnectResults(input).pipe(
    Effect.provideService(Console.Console, testConsole),
    Effect.provide(Logger.layer([Logger.make(() => undefined)], { mergeWithExisting: false })),
    Effect.as(lines),
  );
};

it.effect("warns to deregister when unlink has no stored CLI authorization", () =>
  Effect.gen(function* () {
    const lines = yield* captureDisconnectReport({
      clearAuthorization: false,
      liveResult: { status: "succeeded" },
      relayResult: Exit.succeed({ status: "not-authenticated" }),
    });

    assert.deepEqual(
      lines.map((line) => line.stream),
      ["log", "warn"],
    );
    assert.equal(lines[0]?.text, "T3 Connect is disabled locally.");
    assert.include(lines[1]?.text, "The relay-side environment record was not revoked.");
    assert.include(lines[1]?.text, "T3 Connect page of your T3 account");
    assert.include(lines[1]?.text, "`t3-fork connect login`");
    assert.notInclude(lines.map((line) => line.text).join("\n"), "Revoked the relay-side");
  }),
);

it.effect("points a failed relay unlink at retry and account deregistration", () =>
  Effect.gen(function* () {
    const lines = yield* captureDisconnectReport({
      clearAuthorization: false,
      liveResult: { status: "succeeded" },
      relayResult: Exit.fail("relay unreachable"),
    });
    const warning = lines.find((line) => line.stream === "warn")?.text ?? "";

    assert.equal(lines[0]?.text, "T3 Connect is disabled locally.");
    assert.include(warning, "Run `t3-fork connect unlink` again when the relay is reachable");
    assert.include(warning, "deregister it from the T3 Connect page of your T3 account");
    assert.notInclude(warning, "relay unreachable");
  }),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer))(
  "t3 connect unlink",
  (it) => {
    const runUnlink = (recordedPid: number, options?: { readonly portFreed?: boolean }) =>
      Effect.gen(function* () {
        const requests: Array<string> = [];
        const warnings: Array<string> = [];
        const server = yield* Effect.acquireRelease(
          Effect.callback<NodeHttp.Server>((resume) => {
            const listening = NodeHttp.createServer((request, response) => {
              requests.push(`${request.method} ${request.url}`);
              response.writeHead(200, { "content-type": "application/json" });
              response.end(JSON.stringify({ ok: true, endpointRuntimeStatus: null }));
            });
            listening.listen(0, "127.0.0.1", () => resume(Effect.succeed(listening)));
          }),
          (listening) => Effect.sync(() => listening.close()),
        );
        const address = server.address();
        if (address === null || typeof address === "string") {
          return yield* Effect.die(new Error("Expected a TCP address"));
        }
        if (options?.portFreed) {
          yield* Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          });
        }

        const fs = yield* FileSystem.FileSystem;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-connect-unlink-test-" });
        const state = yield* makePersistedServerRuntimeState({
          config: { host: "127.0.0.1", devUrl: undefined },
          port: address.port,
        });
        yield* persistServerRuntimeState({
          path: `${baseDir}/userdata/server-runtime.json`,
          state: { ...state, pid: recordedPid },
        });

        yield* Command.runWith(makeCli({ cloudEnabled: true }), { version: "0.0.0" })([
          "connect",
          "unlink",
          "--base-dir",
          baseDir,
        ]).pipe(
          // TestConsole has no reader for Console.warn.
          Effect.updateService(Console.Console, (console) => ({
            ...console,
            warn: (...args: ReadonlyArray<unknown>) => {
              warnings.push(args.join(" "));
            },
          })),
        );

        return { requests, warnings, printed: (yield* TestConsole.logLines).join("\n") };
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            Layer.fresh(TestConsole.layer),
          ),
        ),
      );

    // Above Linux's PID ceiling, as in pair.test.ts: no process can hold it.
    const deadPid = 4_194_305;

    it.effect("does not tell the user to restart a server that is gone", () =>
      Effect.gen(function* () {
        const { printed, warnings } = yield* runUnlink(deadPid, { portFreed: true });

        assert.include(printed, "T3 Connect is disabled locally.");
        assert.notInclude(warnings.join("\n"), "Restart that server");
      }),
    );

    it.effect("warns that a server that is gone may have left its connector running", () =>
      Effect.gen(function* () {
        const { warnings } = yield* runUnlink(deadPid, { portFreed: true });

        assert.include(warnings.join("\n"), "its cloudflared process may still be running");
      }),
    );

    it.effect("does not send a token to whatever took over a dead server's port", () =>
      Effect.gen(function* () {
        const { requests } = yield* runUnlink(deadPid);

        assert.deepEqual(requests, []);
      }),
    );

    it.effect("asks a running server to stop its tunnel", () =>
      Effect.gen(function* () {
        const { requests, printed, warnings } = yield* runUnlink(process.pid);

        assert.deepEqual(requests, ["POST /api/connect/unlink"]);
        assert.include(printed, "T3 Connect is disabled locally.");
        assert.notInclude(warnings.join("\n"), "cloudflared process");
      }),
    );
  },
);

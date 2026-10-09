import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  ProjectId,
  ProviderInstanceId,
  WS_METHODS,
  WsRpcGroup,
  type AuthEnvironmentScope,
  type McpStdioTransport,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RpcAuthorization from "./RpcAuthorization.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (
      tag,
    ): tag is Exclude<
      keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES,
      typeof WS_METHODS.serverUpdateSettings
    > => tag !== WS_METHODS.serverUpdateSettings,
  ),
);
const projectId = ProjectId.make("project-a");
const transport: McpStdioTransport = {
  type: "stdio",
  command: "npx",
  args: ["mcp-server"],
  env: [{ name: "TOKEN", sensitive: true, value: "stored-secret" }],
};
const initialPatch: ServerSettingsPatch = {
  projectSettingsOverrides: {
    [projectId]: { mcpServers: { tools: { enabled: true, transport } } },
  },
};

const makeClient = (
  service: ServerSettings.ServerSettingsService["Service"],
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  onRequest: Effect.Effect<void> = Effect.void,
) =>
  RpcTest.makeClient(group).pipe(
    Effect.provide(
      Layer.mergeAll(
        group.toLayerHandler(WS_METHODS.serverUpdateSettings, (input) => {
          const authorize = RpcAuthorization.authorizeSettingsUpdate(scopes, input);
          const update =
            input.providerInstanceMutation === undefined
              ? service.updateSettings(input.patch, authorize)
              : service.updateProviderInstance(
                  input.providerInstanceMutation,
                  input.patch,
                  authorize,
                );
          return onRequest.pipe(
            Effect.andThen(update),
            Effect.map(ServerSettings.redactServerSettingsForClient),
          );
        }),
        RpcAuthorization.layer(scopes),
      ),
    ),
  );

const diskSettingsLayer = () =>
  ServerSettings.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-settings-auth-test-" })),
  );

const settingsLayer = (
  backing: "memory" | "disk",
): Layer.Layer<
  ServerSettings.ServerSettingsService,
  | Layer.Error<ReturnType<typeof ServerSettings.layerTest>>
  | Layer.Error<ReturnType<typeof diskSettingsLayer>>,
  Layer.Services<ReturnType<typeof diskSettingsLayer>>
> => (backing === "memory" ? ServerSettings.layerTest() : diskSettingsLayer());

for (const backing of ["memory", "disk"] as const) {
  it.layer(NodeServices.layer)(`${backing} settings authorization`, (it) => {
    it.effect("allows skills, default model, and server switches while preserving transports", () =>
      Effect.gen(function* () {
        const service = yield* ServerSettings.ServerSettingsService;
        yield* service.updateSettings(initialPatch);
        const snapshot = ServerSettings.redactServerSettingsForClient(yield* service.getSettings);
        const entry = snapshot.projectSettingsOverrides[projectId]!;
        const client = yield* makeClient(service, [AuthSettingsWriteScope]);
        const saved = yield* client[WS_METHODS.serverUpdateSettings]({
          patch: {
            projectSettingsOverrides: {
              [projectId]: {
                ...entry,
                disabledSkills: { review: true },
                defaultModelSelection: {
                  instanceId: ProviderInstanceId.make("codex"),
                  model: "gpt-5",
                },
                mcpServers: {
                  ...entry.mcpServers,
                  tools: { ...entry.mcpServers!.tools!, enabled: false },
                },
              },
            },
          },
        });
        expect(saved.projectSettingsOverrides[projectId]).toMatchObject({
          disabledSkills: { review: true },
          defaultModelSelection: { model: "gpt-5" },
          mcpServers: {
            tools: {
              enabled: false,
              transport: {
                command: "npx",
                env: [{ name: "TOKEN", sensitive: true, value: "", valueRedacted: true }],
              },
            },
          },
        });
        // Disk-backed settings materialize the retained stored secret for providers.
        if (backing === "disk") {
          expect(
            (yield* service.getSettings).projectSettingsOverrides[projectId]?.mcpServers?.tools
              ?.transport,
          ).toMatchObject({
            env: [{ name: "TOKEN", value: "stored-secret" }],
          });
        }
      }).pipe(Effect.provide(settingsLayer(backing)), Effect.scoped),
    );

    it.effect("rejects transport and credential changes before changing settings", () =>
      Effect.gen(function* () {
        const service = yield* ServerSettings.ServerSettingsService;
        yield* service.updateSettings(initialPatch);
        const before = yield* service.getSettings;
        const client = yield* makeClient(service, [AuthSettingsWriteScope]);
        for (const next of [
          { ...transport, command: "unapproved-command" },
          {
            ...transport,
            env: [{ name: "TOKEN", sensitive: true, value: "new-secret", valueRedacted: true }],
          },
        ]) {
          expect(
            yield* client[WS_METHODS.serverUpdateSettings]({
              patch: {
                projectSettingsOverrides: {
                  [projectId]: { mcpServers: { tools: { enabled: true, transport: next } } },
                },
              },
            }).pipe(Effect.flip),
          ).toMatchObject({ requiredPermission: AuthProvidersManageScope });
          expect(yield* service.getSettings).toEqual(before);
        }
        expect(
          yield* client[WS_METHODS.serverUpdateSettings]({
            patch: { projectSettingsOverrides: { [projectId]: null } },
          }).pipe(Effect.flip),
        ).toMatchObject({ requiredPermission: AuthProvidersManageScope });
        expect(yield* service.getSettings).toEqual(before);
      }).pipe(Effect.provide(settingsLayer(backing)), Effect.scoped),
    );

    it.effect("allows transport changes with both required grants", () =>
      Effect.gen(function* () {
        const service = yield* ServerSettings.ServerSettingsService;
        yield* service.updateSettings(initialPatch);
        const client = yield* makeClient(service, [
          AuthSettingsWriteScope,
          AuthProvidersManageScope,
        ]);
        const saved = yield* client[WS_METHODS.serverUpdateSettings]({
          patch: {
            projectSettingsOverrides: {
              [projectId]: {
                mcpServers: {
                  tools: {
                    enabled: true,
                    transport: { ...transport, command: "approved-command" },
                  },
                },
              },
            },
          },
        });
        expect(
          saved.projectSettingsOverrides[projectId]?.mcpServers?.tools?.transport,
        ).toMatchObject({
          command: "approved-command",
        });
      }).pipe(Effect.provide(settingsLayer(backing)), Effect.scoped),
    );

    it.effect(
      "checks queued writes after acquiring the lock so stale edits cannot restore transports",
      () =>
        Effect.gen(function* () {
          const service = yield* ServerSettings.ServerSettingsService;
          yield* service.updateSettings(initialPatch);
          const oldEntry = ServerSettings.redactServerSettingsForClient(yield* service.getSettings)
            .projectSettingsOverrides[projectId]!;
          const locked = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const requested = yield* Deferred.make<void>();
          const admin = yield* service
            .updateSettings(
              {
                projectSettingsOverrides: {
                  [projectId]: {
                    mcpServers: {
                      tools: {
                        enabled: true,
                        transport: { ...transport, command: "approved-new-command" },
                      },
                    },
                  },
                },
              },
              () =>
                Deferred.succeed(locked, undefined).pipe(Effect.andThen(Deferred.await(release))),
            )
            .pipe(Effect.forkScoped);
          yield* Deferred.await(locked);
          const client = yield* makeClient(
            service,
            [AuthSettingsWriteScope],
            Deferred.succeed(requested, undefined).pipe(Effect.asVoid),
          );
          const queued = yield* client[WS_METHODS.serverUpdateSettings]({
            patch: {
              projectSettingsOverrides: {
                [projectId]: { ...oldEntry, disabledSkills: { review: true } },
              },
            },
          }).pipe(Effect.flip, Effect.forkScoped);
          yield* Deferred.await(requested);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(admin);
          expect(yield* Fiber.join(queued)).toMatchObject({
            requiredPermission: AuthProvidersManageScope,
          });
          expect(
            (yield* service.getSettings).projectSettingsOverrides[projectId]?.mcpServers?.tools
              ?.transport,
          ).toMatchObject({
            command: "approved-new-command",
          });
        }).pipe(Effect.provide(settingsLayer(backing)), Effect.scoped),
    );
  });
}

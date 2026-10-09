import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as NetAddress from "effect/net/NetAddress";
import { HttpRouter, HttpServer } from "effect/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";
import * as OutboundMcpConnections from "./OutboundMcpConnections.ts";
import * as OutboundMcpOAuth from "./OutboundMcpOAuth.ts";
import type * as OutboundMcpOAuthHttp from "./OutboundMcpOAuthHttp.ts";
import * as OutboundMcpHttp from "./outboundMcpHttp.ts";

import type { McpProviderSessionTools } from "./McpProviderSession.ts";
import { proxyAgentTools, resolveAgentTools } from "./resolveAgentTools.ts";

const bridgeCredential = {
  endpoint: "http://[::1]:43123/mcp",
  authorizationHeader: "Bearer provider-session-credential",
};
const oauthTransport = {
  type: "http" as const,
  url: "https://mcp.example.com/mcp",
  authentication: "oauth" as const,
  headers: [{ name: "X-Workspace", value: "upstream-only", sensitive: true }],
};

it("bridges only OAuth transports and keeps static HTTP and stdio unchanged", () => {
  const tools: McpProviderSessionTools = {
    servers: [
      { name: "oauth", transport: oauthTransport },
      {
        name: "static",
        transport: {
          type: "http",
          url: "https://static.example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer static-token", sensitive: true }],
        },
      },
      {
        name: "local",
        transport: {
          type: "stdio",
          command: "mcp-server",
          args: ["--read-only"],
          env: [{ name: "API_KEY", value: "stdio-token", sensitive: true }],
        },
      },
    ],
    disabledSkills: ["deploy"],
    fingerprint: "original-upstream-config-fingerprint",
  };
  const bridged = proxyAgentTools(tools, bridgeCredential);
  expect(bridged.servers[0]).toEqual({
    name: "oauth",
    transport: {
      type: "http",
      url: "http://[::1]:43123/api/mcp-oauth/proxy/oauth",
      headers: [
        { name: "Authorization", value: bridgeCredential.authorizationHeader, sensitive: true },
      ],
    },
  });
  expect(bridged.servers.slice(1)).toEqual(tools.servers.slice(1));
  expect(bridged.disabledSkills).toEqual(["deploy"]);
  expect(bridged.fingerprint).toBe(tools.fingerprint);
  expect(tools.servers[0]?.transport).toEqual(oauthTransport);
});

it("retains upstream configuration changes in the fingerprint despite a stable bridge URL", () => {
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    mcpServers: { docs: { enabled: true, transport: oauthTransport } },
  };
  const original = proxyAgentTools(resolveAgentTools(settings, null), bridgeCredential);
  const changed = proxyAgentTools(
    resolveAgentTools(
      {
        ...settings,
        mcpServers: {
          docs: {
            enabled: true,
            transport: { ...oauthTransport, url: "https://new.example.com/mcp" },
          },
        },
      },
      null,
    ),
    bridgeCredential,
  );
  expect(changed.servers).toEqual(original.servers);
  expect(changed.fingerprint).not.toBe(original.fingerprint);
});

it("applies project enables and transport overrides before preparing OAuth bridge config", () => {
  const projectId = ProjectId.make("project:bridge");
  const staticTransport = {
    type: "http" as const,
    url: oauthTransport.url,
    headers: oauthTransport.headers,
  };
  const tools = proxyAgentTools(
    resolveAgentTools(
      {
        ...DEFAULT_SERVER_SETTINGS,
        mcpServers: {
          docs: { enabled: true, transport: oauthTransport },
          disabled: { enabled: true, transport: oauthTransport },
        },
        projectSettingsOverrides: {
          [projectId]: {
            mcpServers: {
              docs: { enabled: true, transport: staticTransport },
              disabled: { enabled: false },
            },
          },
        },
      },
      projectId,
    ),
    bridgeCredential,
  );
  expect(tools.servers).toEqual([{ name: "docs", transport: staticTransport }]);
});

const projectA = ProjectId.make("bridge-project-a");
const projectB = ProjectId.make("bridge-project-b");
const threadA = ThreadId.make("bridge-thread-a");
const threadB = ThreadId.make("bridge-thread-b");
type UpstreamCall = {
  readonly binding: OutboundMcpOAuth.McpOAuthBinding;
  readonly init: OutboundMcpOAuthHttp.OutboundMcpRequestInit;
};
type OAuthBeginInput = Parameters<OutboundMcpOAuth.OutboundMcpOAuth["Service"]["begin"]>[0];
type OAuthBeginResult = Effect.Success<
  ReturnType<OutboundMcpOAuth.OutboundMcpOAuth["Service"]["begin"]>
>;
const authorizationResult = {
  _tag: "authorization",
  authorizationUrl: "https://auth.example.com/authorize?state=server-private-state",
  state: "server-private-state",
  flowId: "authorization-fixture",
  expiresAt: 601_000,
} satisfies OAuthBeginResult;
const trustReview = {
  _tag: "trust-required",
  flowId: "review-fixture",
  expiresAt: 601_000,
  profile: {
    resource: oauthTransport.url,
    issuer: "https://auth.example.com/",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    registrationEndpoint: "https://auth.example.com/register",
    requestedScopes: ["mcp:read", "mcp:write"],
  },
} satisfies OAuthBeginResult;

const withConnections = <A, E>(
  use: (fixture: {
    readonly connections: OutboundMcpConnections.OutboundMcpConnections["Service"];
    readonly registry: McpSessionRegistry.McpSessionRegistry["Service"];
    readonly settings: ServerSettings.ServerSettingsService["Service"];
    readonly calls: UpstreamCall[];
    readonly begins: OAuthBeginInput[];
    readonly statuses: OutboundMcpOAuth.McpOAuthBinding[];
    readonly setBeginResult: (result: OAuthBeginResult) => void;
    readonly setBeginEffect: (effect: Effect.Effect<void>) => void;
    readonly setStatus: (status: OutboundMcpOAuth.McpOAuthStatus) => void;
    readonly completions: string[];
    readonly cancellations: string[];
    readonly setCompleteEffect: (effect: Effect.Effect<void>) => void;
    readonly disconnects: OutboundMcpOAuth.McpOAuthBinding[];
    readonly setPendingBinding: (binding: OutboundMcpOAuth.McpOAuthBinding) => void;
    readonly issue: (threadId: ThreadId, provider?: string) => Effect.Effect<string>;
    readonly setResponse: (response: () => Response) => void;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const registry = yield* McpSessionRegistry.__testing.make({ now: () => 1_000 });
    const calls: UpstreamCall[] = [];
    const begins: OAuthBeginInput[] = [];
    const statuses: OutboundMcpOAuth.McpOAuthBinding[] = [];
    let beginResult: OAuthBeginResult = authorizationResult;
    let beginEffect = Effect.void;
    let status: OutboundMcpOAuth.McpOAuthStatus = { status: "disconnected" };
    const completions: string[] = [];
    const cancellations: string[] = [];
    let completeEffect = Effect.void;
    const disconnects: OutboundMcpOAuth.McpOAuthBinding[] = [];
    let pendingBinding = { owner: "environment", name: "docs", url: oauthTransport.url };
    let response = () =>
      Response.json(
        { result: "ok" },
        {
          headers: { "mcp-session-id": "upstream-session" },
        },
      );
    const oauth = Layer.mock(OutboundMcpOAuth.OutboundMcpOAuth)({
      begin: (input) =>
        Effect.gen(function* () {
          begins.push(input);
          yield* beginEffect;
          return beginResult;
        }),
      status: (binding) =>
        Effect.sync(() => {
          statuses.push(binding);
          return status;
        }),
      authorizedFetch: (binding, init = {}) =>
        Effect.sync(() => {
          calls.push({ binding, init });
          return response();
        }),
      disconnect: (binding) =>
        Effect.sync(() => {
          disconnects.push(binding);
        }),
      pendingBinding: () => Effect.succeed(pendingBinding),
      complete: ({ state }) =>
        Effect.gen(function* () {
          yield* completeEffect;
          completions.push(state);
          return { binding: pendingBinding, flowId: "flow-fixture" };
        }),
      cancel: (_binding, flowId) =>
        Effect.sync(() => {
          cancellations.push(flowId ?? "");
        }),
    });
    const projection = Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThread: (threadId) =>
        Effect.succeed({
          ...liveThreadShell(threadId),
          projectId: threadId === threadB ? projectB : projectA,
          lastVisitedAt: null,
        }),
    });
    return yield* Effect.gen(function* () {
      const connections = yield* OutboundMcpConnections.OutboundMcpConnections;
      return yield* use({
        connections,
        registry,
        settings,
        calls,
        begins,
        statuses,
        setBeginResult: (result) => {
          beginResult = result;
        },
        setBeginEffect: (effect) => {
          beginEffect = effect;
        },
        setStatus: (next) => {
          status = next;
        },
        completions,
        cancellations,
        setCompleteEffect: (effect) => {
          completeEffect = effect;
        },
        disconnects,
        setPendingBinding: (binding) => {
          pendingBinding = binding;
        },
        issue: (threadId, provider = "codex") =>
          registry
            .issue({
              threadId,
              providerInstanceId: ProviderInstanceId.make(provider),
            })
            .pipe(Effect.map(({ config }) => config.authorizationHeader.replace(/^Bearer\s+/, ""))),
        setResponse: (next) => {
          response = next;
        },
      });
    }).pipe(
      Effect.provide(
        OutboundMcpConnections.layer.pipe(
          Layer.provide(oauth),
          Layer.provide(projection),
          Layer.provide(Layer.succeed(McpSessionRegistry.McpSessionRegistry, registry)),
          Layer.provide(Layer.succeed(ServerSettings.ServerSettingsService, settings)),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      ServerSettings.layerTest({
        mcpServers: { docs: { enabled: true, transport: oauthTransport } },
      }),
    ),
    Effect.provideService(
      ServerEnvironment.ServerEnvironment,
      ServerEnvironment.ServerEnvironment.of({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("environment:oauth-bridge")),
        getDescriptor: Effect.die("unused"),
      }),
    ),
    Effect.provideService(
      HttpServer.HttpServer,
      HttpServer.HttpServer.of({
        address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 43123),
        serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
      }),
    ),
    Effect.provide(NodeServices.layer),
  );

const request = (
  token: string,
  extra: Partial<OutboundMcpConnections.McpOAuthProxyRequest> = {},
): OutboundMcpConnections.McpOAuthProxyRequest => ({
  token,
  name: "docs",
  method: "POST",
  headers: {},
  ...extra,
});

it.effect.each(["environment", "project"] as const)(
  "keeps trust review and approval bound to the saved %s transport and callback",
  (scope) =>
    withConnections(({ connections, settings, begins, statuses, setBeginResult, setStatus }) =>
      Effect.gen(function* () {
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectA]: { mcpServers: { docs: { enabled: true, transport: oauthTransport } } },
          },
        });
        const target = { name: "docs", ...(scope === "project" ? { projectId: projectA } : {}) };
        const binding = {
          owner: scope === "project" ? `project:${projectA}` : "environment",
          name: "docs",
          url: oauthTransport.url,
        };
        const callbackOrigin = "https://remote-environment.example.com";
        const redirectUri = `${callbackOrigin}/api/mcp-oauth/callback`;
        setBeginResult(trustReview);
        expect(yield* connections.begin(target, callbackOrigin)).toEqual(trustReview);
        expect(begins).toEqual([{ binding, redirectUri }]);

        const reviewStatus = {
          status: "trust-required" as const,
          flowId: trustReview.flowId,
          expiresAt: trustReview.expiresAt,
          profile: trustReview.profile,
        };
        setStatus(reviewStatus);
        expect(yield* connections.status(target)).toEqual(reviewStatus);
        expect(statuses).toEqual([binding]);

        setBeginResult(authorizationResult);
        expect(
          yield* connections.begin(
            { ...target, approvedReviewId: trustReview.flowId },
            callbackOrigin,
          ),
        ).toEqual({
          _tag: "authorization",
          authorizationUrl: authorizationResult.authorizationUrl,
          flowId: authorizationResult.flowId,
          expiresAt: authorizationResult.expiresAt,
        });
        expect(begins).toEqual([
          { binding, redirectUri },
          { binding, redirectUri, approvedReviewId: trustReview.flowId },
        ]);
      }),
    ),
);

it.effect("does not bind trust approval to an inherited project enable switch", () =>
  withConnections(({ connections, settings, begins, statuses }) =>
    Effect.gen(function* () {
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectA]: { mcpServers: { docs: { enabled: true } } },
        },
      });
      const target = { name: "docs", projectId: projectA };
      const rejected = yield* connections
        .begin(
          { ...target, approvedReviewId: trustReview.flowId },
          "https://remote-environment.example.com",
        )
        .pipe(Effect.flip);
      expect(rejected.code).toBe("not_found");
      expect((yield* connections.status(target).pipe(Effect.flip)).code).toBe("not_found");
      expect(begins).toEqual([]);
      expect(statuses).toEqual([]);
    }),
  ),
);

it.effect.each([
  { result: authorizationResult, change: "remove" },
  { result: authorizationResult, change: "replace-url" },
  { result: trustReview, change: "remove" },
  { result: trustReview, change: "replace-url" },
] as const)(
  "invalidates a pending $result._tag result when its saved transport changes: $change",
  ({ result, change }) =>
    withConnections(({ connections, settings, disconnects, setBeginResult, setBeginEffect }) =>
      Effect.gen(function* () {
        const beginStarted = yield* Deferred.make<void>();
        const releaseBegin = yield* Deferred.make<void>();
        setBeginResult(result);
        setBeginEffect(
          Deferred.succeed(beginStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseBegin)),
          ),
        );
        const pending = yield* connections
          .begin({ name: "docs" }, "https://remote-environment.example.com")
          .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(beginStarted);
        yield* settings.updateSettings({
          mcpServers: {
            docs:
              change === "remove"
                ? null
                : {
                    enabled: true,
                    transport: { ...oauthTransport, url: "https://replacement.example.com/mcp" },
                  },
          },
        });
        yield* Deferred.succeed(releaseBegin, undefined);
        expect((yield* Fiber.join(pending)).code).toBe("not_found");
        expect(disconnects).toEqual([
          { owner: "environment", name: "docs", url: oauthTransport.url },
        ]);
      }),
    ),
);

it.effect(
  "rejects missing, invalid, external and revoked credentials before contacting upstream",
  () =>
    withConnections(({ connections, registry, calls, issue }) =>
      Effect.gen(function* () {
        for (const token of ["", "invalid", "external.oauth.signature"]) {
          const error = yield* connections.proxy(request(token)).pipe(Effect.flip);
          expect(error.status).toBe(401);
        }
        const token = yield* issue(threadA);
        yield* registry.revokeThread(threadA);
        const error = yield* connections.proxy(request(token)).pipe(Effect.flip);
        expect(error.status).toBe(401);
        expect(calls).toEqual([]);
      }),
    ),
);

it.effect("resolves inherited global credentials and isolates same-name project overrides", () =>
  withConnections(({ connections, settings, calls, issue, setResponse }) =>
    Effect.gen(function* () {
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectA]: { mcpServers: { docs: { enabled: true } } },
          [projectB]: { mcpServers: { docs: { enabled: true, transport: oauthTransport } } },
        },
      });
      const tokenA = yield* issue(threadA);
      const tokenB = yield* issue(threadB);
      yield* connections.proxy(request(tokenA));
      setResponse(() => Response.json({}, { headers: { "mcp-session-id": "project-b-session" } }));
      yield* connections.proxy(request(tokenB));
      expect(calls.map(({ binding }) => binding)).toEqual([
        { owner: "environment", name: "docs", url: oauthTransport.url },
        { owner: `project:${projectB}`, name: "docs", url: oauthTransport.url },
      ]);
      const crossProjectSession = yield* connections
        .proxy(
          request(tokenA, {
            headers: { "mcp-session-id": "project-b-session" },
          }),
        )
        .pipe(Effect.flip);
      expect(crossProjectSession.status).toBe(409);
      expect(calls).toHaveLength(2);
    }),
  ),
);

it.effect.each(["disable", "remove", "static"] as const)(
  "rechecks saved settings after preparation when an OAuth server is changed to %s",
  (change) =>
    withConnections(({ connections, settings, calls, issue }) =>
      Effect.gen(function* () {
        const token = yield* issue(threadA);
        yield* connections.proxy(request(token));
        const staticTransport = { type: "http" as const, url: oauthTransport.url, headers: [] };
        yield* settings.updateSettings({
          mcpServers: {
            docs:
              change === "remove"
                ? null
                : {
                    enabled: change !== "disable",
                    transport: change === "static" ? staticTransport : oauthTransport,
                  },
          },
        });
        const error = yield* connections
          .proxy(
            request(token, {
              headers: { "mcp-session-id": "upstream-session" },
            }),
          )
          .pipe(Effect.flip);
        expect(error.status).toBe(403);
        expect(calls).toHaveLength(1);
      }),
    ),
);

it.effect("does not reuse an upstream session after the configured OAuth URL changes", () =>
  withConnections(({ connections, settings, calls, issue }) =>
    Effect.gen(function* () {
      const token = yield* issue(threadA);
      yield* connections.proxy(request(token));
      yield* settings.updateSettings({
        mcpServers: {
          docs: {
            enabled: true,
            transport: { ...oauthTransport, url: "https://replacement.example.com/mcp" },
          },
        },
      });
      const error = yield* connections
        .proxy(
          request(token, {
            headers: { "mcp-session-id": "upstream-session" },
          }),
        )
        .pipe(Effect.flip);
      expect(error.status).toBe(409);
      expect(calls).toHaveLength(1);
      yield* connections.proxy(request(token));
      expect(calls[1]?.binding.url).toBe("https://replacement.example.com/mcp");
    }),
  ),
);

it.effect(
  "shares OAuth ownership across Codex, Claude and OpenCode but isolates their MCP sessions",
  () =>
    withConnections(({ connections, calls, issue }) =>
      Effect.gen(function* () {
        const codex = yield* issue(threadA, "codex");
        const claude = yield* issue(threadA, "claudeAgent");
        const opencode = yield* issue(threadA, "opencode");
        yield* connections.proxy(request(codex));
        for (const token of [claude, opencode]) {
          const error = yield* connections
            .proxy(
              request(token, {
                headers: { "mcp-session-id": "upstream-session" },
              }),
            )
            .pipe(Effect.flip);
          expect(error.status).toBe(409);
          yield* connections.proxy(request(token));
        }
        expect(calls).toHaveLength(3);
        expect(calls.map(({ binding }) => binding)).toEqual(
          Array.from({ length: 3 }, () => ({
            owner: "environment",
            name: "docs",
            url: oauthTransport.url,
          })),
        );
      }),
    ),
);

it.effect("forwards only MCP request headers and streams a filtered response", () =>
  withConnections(({ connections, calls, issue, setResponse }) =>
    Effect.gen(function* () {
      const token = yield* issue(threadA);
      const upstream = new Response('event: message\ndata: {"ok":true}\n\n', {
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "stream-session",
          "mcp-protocol-version": "2025-06-18",
          "set-cookie": "secret=upstream",
          "www-authenticate": "Bearer upstream-challenge",
          "x-internal-secret": "hidden",
        },
      });
      setResponse(() => upstream);
      const body = new TextEncoder().encode('{"jsonrpc":"2.0","method":"tools/list","id":1}');
      const response = yield* connections.proxy(
        request(token, {
          headers: {
            accept: "text/event-stream, application/json",
            "content-type": "application/json",
            "mcp-protocol-version": "2025-06-18",
            "last-event-id": "resume-point",
            authorization: "Bearer provider-session-credential",
            cookie: "browser=private",
            host: "attacker.example.com",
            "x-forwarded-host": "attacker.example.com",
          },
          body,
        }),
      );
      const headers = new Headers(calls[0]?.init.headers);
      expect(Object.fromEntries(headers)).toEqual({
        accept: "text/event-stream, application/json",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        "last-event-id": "resume-point",
        "x-workspace": "upstream-only",
      });
      expect(calls[0]?.init.body).toBe(body);
      expect(response.body).toBe(upstream.body);
      expect(Object.fromEntries(response.headers)).toEqual({
        "cache-control": "no-store, no-transform",
        "content-type": "text/event-stream",
        "mcp-session-id": "stream-session",
        "mcp-protocol-version": "2025-06-18",
      });
      expect(yield* Effect.promise(() => response.text())).toBe(
        'event: message\ndata: {"ok":true}\n\n',
      );
    }),
  ),
);

it.effect("invalidates upstream sessions on successful deletion and disconnect", () =>
  withConnections(({ connections, calls, issue, setResponse }) =>
    Effect.gen(function* () {
      const token = yield* issue(threadA);
      yield* connections.proxy(request(token));
      setResponse(() => new Response(null, { status: 204 }));
      yield* connections.proxy(
        request(token, {
          method: "DELETE",
          headers: { "mcp-session-id": "upstream-session" },
        }),
      );
      const deleted = yield* connections
        .proxy(
          request(token, {
            headers: { "mcp-session-id": "upstream-session" },
          }),
        )
        .pipe(Effect.flip);
      expect(deleted.status).toBe(409);
      setResponse(() =>
        Response.json({}, { headers: { "mcp-session-id": "reconnected-session" } }),
      );
      yield* connections.proxy(request(token));
      yield* connections.disconnect({ name: "docs" });
      const disconnected = yield* connections
        .proxy(
          request(token, {
            headers: { "mcp-session-id": "reconnected-session" },
          }),
        )
        .pipe(Effect.flip);
      expect(disconnected.status).toBe(409);
      expect(calls).toHaveLength(3);
    }),
  ),
);

it.effect("authenticates the HTTP bridge with only its provider credential and streams SSE", () =>
  withConnections(({ connections, calls, issue, setResponse }) =>
    Effect.gen(function* () {
      const token = yield* issue(threadA);
      setResponse(
        () =>
          new Response('data: {"ok":true}\n\n', {
            headers: { "content-type": "text/event-stream", "mcp-session-id": "stream-session" },
          }),
      );
      yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            OutboundMcpHttp.layer.pipe(
              Layer.provideMerge(
                Layer.succeed(OutboundMcpConnections.OutboundMcpConnections, connections),
              ),
            ),
            { disableLogger: true },
          ),
        ),
        (web) =>
          Effect.promise(async () => {
            const endpoint = "http://127.0.0.1/api/mcp-oauth/proxy/docs";
            const deniedHeaders: ReadonlyArray<Record<string, string>> = [
              {},
              { cookie: `t3_session=${token}` },
              { authorization: "Bearer external.oauth.signature" },
              { authorization: `Basic ${token}` },
            ];
            for (const headers of deniedHeaders) {
              const denied = await web.handler(new Request(endpoint, { headers }));
              expect(denied.status).toBe(401);
              expect(await denied.json()).toMatchObject({ error: "mcp_connection_unavailable" });
            }
            expect(calls).toEqual([]);
            const query = await web.handler(
              new Request(`${endpoint}?url=https://attacker.example/mcp`, {
                headers: { authorization: `Bearer ${token}` },
              }),
            );
            expect(query.status).toBe(400);
            expect(calls).toEqual([]);

            const response = await web.handler(
              new Request(endpoint, {
                method: "POST",
                headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: '{"jsonrpc":"2.0","method":"initialize","id":1}',
              }),
            );
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("text/event-stream");
            expect(response.headers.get("mcp-session-id")).toBe("stream-session");
            expect(await response.text()).toBe('data: {"ok":true}\n\n');
            expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe(
              '{"jsonrpc":"2.0","method":"initialize","id":1}',
            );
            expect(new Headers(calls[0]?.init.headers).has("authorization")).toBe(false);
          }),
        (web) => Effect.promise(() => web.dispose()),
      );
    }),
  ),
);

it.effect(
  "maps rejected upstream authorization to a safe HTTP error and clears the MCP session",
  () =>
    withConnections(({ connections, calls, issue, setResponse }) =>
      Effect.gen(function* () {
        const token = yield* issue(threadA);
        yield* connections.proxy(request(token));
        setResponse(
          () =>
            new Response("upstream-private-error-body", {
              status: 401,
              headers: { "www-authenticate": "Bearer secret-upstream-challenge" },
            }),
        );
        const rejected = yield* connections
          .proxy(
            request(token, {
              headers: { "mcp-session-id": "upstream-session" },
            }),
          )
          .pipe(Effect.flip);
        expect(rejected.status).toBe(502);
        expect(rejected.message).not.toContain("upstream-private");
        const stale = yield* connections
          .proxy(
            request(token, {
              headers: { "mcp-session-id": "upstream-session" },
            }),
          )
          .pipe(Effect.flip);
        expect(stale.status).toBe(409);
        expect(calls).toHaveLength(2);
      }),
    ),
);

it.effect("invalidates the upstream MCP session when configured headers change", () =>
  withConnections(({ connections, settings, calls, issue }) =>
    Effect.gen(function* () {
      const token = yield* issue(threadA);
      yield* connections.proxy(request(token));
      yield* settings.updateSettings({
        mcpServers: {
          docs: {
            enabled: true,
            transport: {
              ...oauthTransport,
              headers: [{ name: "X-Workspace", value: "different-account", sensitive: true }],
            },
          },
        },
      });
      const stale = yield* connections
        .proxy(
          request(token, {
            headers: { "mcp-session-id": "upstream-session" },
          }),
        )
        .pipe(Effect.flip);
      expect(stale.status).toBe(409);
      expect(calls).toHaveLength(1);
      yield* connections.proxy(request(token));
      expect(new Headers(calls[1]?.init.headers).get("x-workspace")).toBe("different-account");
    }),
  ),
);

it.effect.each(["https://mcp.example.com", "https://MCP.example.com:443"])(
  "accepts a normalized callback binding for saved OAuth URL %s",
  (savedUrl) =>
    withConnections(({ connections, settings, completions, disconnects, setPendingBinding }) =>
      Effect.gen(function* () {
        yield* settings.updateSettings({
          mcpServers: {
            docs: {
              enabled: true,
              transport: { ...oauthTransport, url: savedUrl },
            },
          },
        });
        setPendingBinding({ owner: "environment", name: "docs", url: "https://mcp.example.com/" });
        yield* connections.complete({ state: "state-for-bare-origin", code: "authorization-code" });
        expect(completions).toEqual(["state-for-bare-origin"]);
        expect(disconnects).toEqual([]);
      }),
    ),
);

it.effect.each(["cancel", "disconnect"] as const)(
  "lets %s invalidate authorization while callback token exchange is in progress",
  (action) =>
    withConnections(({ connections, completions, cancellations, disconnects, setCompleteEffect }) =>
      Effect.gen(function* () {
        const exchangeStarted = yield* Deferred.make<void>();
        const releaseExchange = yield* Deferred.make<void>();
        setCompleteEffect(
          Deferred.succeed(exchangeStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseExchange)),
          ),
        );
        const callback = yield* connections
          .complete({ state: "pending-callback", code: "authorization-code" })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(exchangeStarted);
        if (action === "cancel")
          yield* connections.cancel({ name: "docs", flowId: "flow-fixture" });
        else yield* connections.disconnect({ name: "docs" });
        expect(completions).toEqual([]);
        if (action === "cancel") expect(cancellations).toEqual(["flow-fixture"]);
        else
          expect(disconnects).toEqual([
            { owner: "environment", name: "docs", url: oauthTransport.url },
          ]);
        yield* Deferred.succeed(releaseExchange, undefined);
        yield* Fiber.join(callback);
      }),
    ),
);

it.effect.each(["remove", "replace-url"] as const)(
  "rejects a callback if its saved transport changes during token exchange: %s",
  (change) =>
    withConnections(({ connections, settings, disconnects, setCompleteEffect }) =>
      Effect.gen(function* () {
        const exchangeStarted = yield* Deferred.make<void>();
        const releaseExchange = yield* Deferred.make<void>();
        setCompleteEffect(
          Deferred.succeed(exchangeStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseExchange)),
          ),
        );
        const callback = yield* connections
          .complete({ state: "pending-callback", code: "authorization-code" })
          .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(exchangeStarted);
        yield* settings.updateSettings({
          mcpServers: {
            docs:
              change === "remove"
                ? null
                : {
                    enabled: true,
                    transport: { ...oauthTransport, url: "https://replacement.example.com/mcp" },
                  },
          },
        });
        yield* Deferred.succeed(releaseExchange, undefined);
        expect((yield* Fiber.join(callback)).code).toBe("not_found");
        expect(disconnects).toEqual([
          { owner: "environment", name: "docs", url: oauthTransport.url },
        ]);
      }),
    ),
);

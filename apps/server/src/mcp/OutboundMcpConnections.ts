import {
  McpOAuthError,
  ProjectId,
  isValidMcpServerName,
  mcpServerVariableRecord,
  type McpOAuthBeginInput,
  type McpOAuthBeginResult,
  type McpOAuthCancelInput,
  type McpOAuthStatus,
  type McpOAuthTarget,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as OutboundMcpOAuth from "./OutboundMcpOAuth.ts";
import {
  oauthBinding,
  savedOAuthBindings,
  savedOAuthTransport,
  sameOAuthBinding,
} from "./outboundMcpBindings.ts";
import { resolveAgentTools } from "./resolveAgentTools.ts";

export const OUTBOUND_MCP_CALLBACK_PATH = "/api/mcp-oauth/callback";
export const OUTBOUND_MCP_PROXY_PREFIX = "/api/mcp-oauth/proxy/";

export class McpOAuthProxyError extends Schema.TaggedError<McpOAuthProxyError>()(
  "McpOAuthProxyError",
  {
    status: Schema.Number,
  },
) {
  override get message(): string {
    return this.status === 401
      ? "This agent session is no longer authorized."
      : this.status === 403
        ? "This MCP server is not available to this thread."
        : this.status === 409
          ? "Reconnect this MCP client after changing its connection."
          : this.status === 400
            ? "Invalid MCP proxy request."
            : "This MCP connection needs attention in Settings → Tools.";
  }
}

export interface McpOAuthCallback {
  readonly state: string;
  readonly code?: string;
  readonly error?: string;
  readonly issuer?: string;
}

export interface McpOAuthProxyRequest {
  readonly token: string;
  readonly name: string;
  readonly method: "GET" | "POST" | "DELETE";
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: Uint8Array;
}

export class OutboundMcpConnections extends Context.Service<
  OutboundMcpConnections,
  {
    readonly begin: (
      target: McpOAuthBeginInput,
      callbackOrigin: string,
    ) => Effect.Effect<McpOAuthBeginResult, McpOAuthError>;
    readonly status: (target: McpOAuthTarget) => Effect.Effect<McpOAuthStatus, McpOAuthError>;
    readonly cancel: (input: McpOAuthCancelInput) => Effect.Effect<void, McpOAuthError>;
    readonly disconnect: (target: McpOAuthTarget) => Effect.Effect<void, McpOAuthError>;
    readonly complete: (input: McpOAuthCallback) => Effect.Effect<void, McpOAuthError>;
    readonly proxy: (input: McpOAuthProxyRequest) => Effect.Effect<Response, McpOAuthProxyError>;
  }
>()("t3/mcp/OutboundMcpConnections") {}

// Neither lower-level defects nor remote OAuth responses may reach RPC or HTTP output.
const connectionError = () =>
  new McpOAuthError({
    code: "unavailable",
    message:
      "Could not complete MCP sign-in. Check that the server supports OAuth with dynamic client registration, then try again.",
  });
const mapConnectionError = (error: unknown): McpOAuthError => {
  if (Schema.is(McpOAuthError)(error)) return error;
  if (Schema.is(OutboundMcpOAuth.OutboundMcpOAuthError)(error)) {
    const code =
      error.code === "unsupported"
        ? "unsupported"
        : error.code === "invalid_state" || error.code === "expired" || error.code === "cancelled"
          ? "expired"
          : error.code === "unsafe_url" || error.code === "invalid_binding"
            ? "invalid_configuration"
            : error.code === "denied" ||
                error.code === "token_failed" ||
                error.code === "invalid_response"
              ? "authorization_failed"
              : "unavailable";
    return new McpOAuthError({ code, message: error.message });
  }
  return connectionError();
};
const notFound = () =>
  new McpOAuthError({
    code: "not_found",
    message: "Save this server with browser sign-in before connecting.",
  });
const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
] as const;
const RESPONSE_HEADERS = [
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "retry-after",
] as const;
const MAX_SESSIONS = 2048;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const oauth = yield* OutboundMcpOAuth.OutboundMcpOAuth;
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  const sessions = new Map<
    string,
    { readonly binding: OutboundMcpOAuth.McpOAuthBinding; readonly touched: number }
  >();
  const clearSessions = (binding: OutboundMcpOAuth.McpOAuthBinding) => {
    for (const [key, record] of sessions)
      if (sameOAuthBinding(binding, record.binding)) sessions.delete(key);
  };
  const withTarget = <A, E>(
    target: McpOAuthTarget,
    use: (binding: OutboundMcpOAuth.McpOAuthBinding) => Effect.Effect<A, E>,
  ) =>
    settings.getSettings.pipe(
      Effect.flatMap((snapshot) =>
        Effect.gen(function* () {
          const transport = savedOAuthTransport(snapshot, target);
          if (transport === undefined) return yield* notFound();
          return yield* use(oauthBinding(target, transport));
        }),
      ),
      Effect.mapError((error) => mapConnectionError(error)),
    );

  const begin: OutboundMcpConnections["Service"]["begin"] = (target, callbackOrigin) =>
    withTarget(target, (binding) =>
      Effect.gen(function* () {
        const started = yield* oauth.begin({
          binding,
          redirectUri: `${callbackOrigin}${OUTBOUND_MCP_CALLBACK_PATH}`,
          ...(target.approvedReviewId === undefined
            ? {}
            : { approvedReviewId: target.approvedReviewId }),
        });
        const current = yield* settings.getSettings;
        const transport = savedOAuthTransport(current, target);
        if (
          transport === undefined ||
          !sameOAuthBinding(binding, oauthBinding(target, transport))
        ) {
          yield* oauth.disconnect(binding);
          return yield* notFound();
        }
        return started._tag === "trust-required"
          ? started
          : {
              _tag: started._tag,
              flowId: started.flowId,
              authorizationUrl: started.authorizationUrl,
              expiresAt: started.expiresAt,
            };
      }),
    );
  const status: OutboundMcpConnections["Service"]["status"] = (target) =>
    withTarget(target, oauth.status);
  const cancel: OutboundMcpConnections["Service"]["cancel"] = (input) =>
    withTarget(input, (binding) => oauth.cancel(binding, input.flowId));
  const disconnect: OutboundMcpConnections["Service"]["disconnect"] = (target) =>
    withTarget(target, (binding) =>
      oauth.disconnect(binding).pipe(Effect.tap(() => Effect.sync(() => clearSessions(binding)))),
    );
  const complete: OutboundMcpConnections["Service"]["complete"] = (input) =>
    settings.getSettings.pipe(
      Effect.flatMap((snapshot) =>
        Effect.gen(function* () {
          const binding = yield* oauth.pendingBinding(input.state);
          if (!savedOAuthBindings(snapshot).some((entry) => sameOAuthBinding(entry, binding))) {
            yield* oauth.disconnect(binding);
            return yield* notFound();
          }
          yield* oauth.complete(input);
          const current = yield* settings.getSettings;
          if (!savedOAuthBindings(current).some((entry) => sameOAuthBinding(entry, binding))) {
            yield* oauth.disconnect(binding);
            return yield* notFound();
          }
          clearSessions(binding);
        }),
      ),
      Effect.mapError(mapConnectionError),
    );

  const proxy: OutboundMcpConnections["Service"]["proxy"] = Effect.fn(
    "OutboundMcpConnections.proxy",
  )(function* (input) {
    if (!isValidMcpServerName(input.name)) return yield* new McpOAuthProxyError({ status: 400 });
    const invocation = yield* registry.resolve(input.token);
    if (invocation === undefined) return yield* new McpOAuthProxyError({ status: 401 });
    const thread = yield* projection
      .getThread(invocation.thread.threadId)
      .pipe(Effect.mapError(() => new McpOAuthProxyError({ status: 403 })));
    return yield* settings.getSettings.pipe(
      Effect.flatMap((snapshot) =>
        Effect.gen(function* () {
          const server = resolveAgentTools(snapshot, thread.projectId).servers.find(
            (entry) => entry.name === input.name,
          );
          if (server?.transport.type !== "http" || server.transport.authentication !== "oauth") {
            return yield* new McpOAuthProxyError({ status: 403 });
          }
          const own =
            snapshot.projectSettingsOverrides[thread.projectId]?.mcpServers?.[input.name]
              ?.transport;
          const binding = oauthBinding(
            {
              name: input.name,
              ...(own === undefined ? {} : { projectId: ProjectId.make(thread.projectId) }),
            },
            server.transport,
          );
          const now = yield* Clock.currentTimeMillis;
          for (const [key, record] of sessions)
            if (now - record.touched > SESSION_TTL_MS) sessions.delete(key);
          const sessionKey = (id: string) =>
            JSON.stringify([
              invocation.thread.providerSessionId,
              binding.owner,
              binding.name,
              binding.url,
              server.transport,
              id,
            ]);
          const sessionId = input.headers["mcp-session-id"];
          if (
            sessionId !== undefined &&
            (!sessions.has(sessionKey(sessionId)) || sessionId.length > 1024)
          ) {
            return yield* new McpOAuthProxyError({ status: 409 });
          }
          const headers = new Headers(mcpServerVariableRecord(server.transport.headers));
          for (const name of REQUEST_HEADERS) {
            const value = input.headers[name];
            if (value !== undefined) headers.set(name, value);
          }
          for (const name of [
            "host",
            "connection",
            "transfer-encoding",
            "content-length",
            "proxy-authorization",
            "upgrade",
          ])
            headers.delete(name);
          const response = yield* oauth.authorizedFetch(binding, {
            method: input.method,
            headers,
            ...(input.body === undefined ? {} : { body: input.body }),
          });
          if (response.status === 401 || response.status === 403) {
            yield* Effect.promise(
              () => response.body?.cancel().catch(() => undefined) ?? Promise.resolve(),
            );
            clearSessions(binding);
            return yield* new McpOAuthProxyError({ status: 502 });
          }
          const returnedId = response.headers.get("mcp-session-id") ?? sessionId;
          if (returnedId !== undefined && returnedId !== null) {
            if (returnedId.length > 1024 || !/^[\x21-\x7e]+$/.test(returnedId)) {
              yield* Effect.promise(
                () => response.body?.cancel().catch(() => undefined) ?? Promise.resolve(),
              );
              return yield* new McpOAuthProxyError({ status: 502 });
            }
            if (input.method === "DELETE" && response.ok) sessions.delete(sessionKey(returnedId));
            else {
              if (sessions.size >= MAX_SESSIONS && !sessions.has(sessionKey(returnedId))) {
                yield* Effect.promise(
                  () => response.body?.cancel().catch(() => undefined) ?? Promise.resolve(),
                );
                return yield* new McpOAuthProxyError({ status: 502 });
              }
              sessions.set(sessionKey(returnedId), { binding, touched: now });
            }
          }
          const safeHeaders = new Headers({ "cache-control": "no-store, no-transform" });
          for (const name of RESPONSE_HEADERS) {
            const value = response.headers.get(name);
            if (value !== null) safeHeaders.set(name, value);
          }
          return new Response(response.body, { status: response.status, headers: safeHeaders });
        }),
      ),
      Effect.mapError((error) =>
        Schema.is(McpOAuthProxyError)(error) ? error : new McpOAuthProxyError({ status: 502 }),
      ),
    );
  });
  return OutboundMcpConnections.of({ begin, status, cancel, disconnect, complete, proxy });
});

export const layer = Layer.effect(OutboundMcpConnections, make);

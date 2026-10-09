import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  HttpIncomingMessage,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as OutboundMcpConnections from "./OutboundMcpConnections.ts";

const PAGE_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const callback = HttpMiddleware.withLoggerDisabled(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const connections = yield* OutboundMcpConnections.OutboundMcpConnections;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url))
      return HttpServerResponse.text("Invalid sign-in response.", {
        status: 400,
        headers: PAGE_HEADERS,
      });
    const params = url.value.searchParams;
    // Reject ambiguous security parameters instead of allowing different parsers to choose differently.
    if (
      ["state", "code", "error", "iss"].some((name) => params.getAll(name).length > 1) ||
      !params.has("state") ||
      params.get("state")!.length > 256 ||
      params.has("code") === params.has("error") ||
      (params.get("code")?.length ?? 0) > 16_384 ||
      (params.get("iss")?.length ?? 0) > 4096
    ) {
      return HttpServerResponse.text("Invalid sign-in response. Return to T3 Code and try again.", {
        status: 400,
        headers: PAGE_HEADERS,
      });
    }
    const result = yield* connections
      .complete({
        state: params.get("state")!,
        ...(params.has("code") ? { code: params.get("code")! } : {}),
        ...(params.has("error") ? { error: params.get("error")! } : {}),
        ...(params.has("iss") ? { issuer: params.get("iss")! } : {}),
      })
      .pipe(
        Effect.match({
          onFailure: () => ({
            status: 400,
            message:
              "Sign-in was not completed. Return to T3 Code, check the connection status, and try again.",
          }),
          onSuccess: () => ({
            status: 200,
            message: "Connected. You can close this tab and return to T3 Code.",
          }),
        }),
      );
    // No redirects, scripts, interpolation, or external assets on a page carrying an OAuth code.
    return HttpServerResponse.text(result.message, {
      status: result.status,
      headers: PAGE_HEADERS,
    });
  }),
);

const proxy = HttpMiddleware.withLoggerDisabled(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const connections = yield* OutboundMcpConnections.OutboundMcpConnections;
    const url = HttpServerRequest.toURL(request);
    if (
      Option.isNone(url) ||
      url.value.search ||
      (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE")
    ) {
      return HttpServerResponse.text("Invalid MCP proxy request.", {
        status: 400,
        headers: PAGE_HEADERS,
      });
    }
    const name = url.value.pathname.slice(OutboundMcpConnections.OUTBOUND_MCP_PROXY_PREFIX.length);
    const authorization = request.headers.authorization ?? "";
    // Browser cookies and externally granted inbound MCP OAuth credentials never authorize this route.
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const body =
      request.method === "POST"
        ? yield* request.arrayBuffer.pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(8)),
            Effect.map((buffer) => new Uint8Array(buffer)),
            Effect.mapError(() => new OutboundMcpConnections.McpOAuthProxyError({ status: 413 })),
          )
        : undefined;
    const response = yield* connections.proxy({
      token,
      name,
      method: request.method,
      headers: request.headers,
      ...(body === undefined ? {} : { body }),
    });
    const options = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    };
    const responseBody = response.body;
    return responseBody === null
      ? HttpServerResponse.empty(options)
      : HttpServerResponse.stream(
          Stream.fromReadableStream({
            evaluate: () => responseBody,
            onError: () => new OutboundMcpConnections.McpOAuthProxyError({ status: 502 }),
          }),
          options,
        );
  }).pipe(
    Effect.catchTags({
      McpOAuthProxyError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: "mcp_connection_unavailable", message: error.message },
            { status: error.status, headers: PAGE_HEADERS },
          ),
        ),
    }),
  ),
);

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", OutboundMcpConnections.OUTBOUND_MCP_CALLBACK_PATH, callback);
    for (const method of ["GET", "POST", "DELETE"] as const) {
      yield* router.add(method, `${OutboundMcpConnections.OUTBOUND_MCP_PROXY_PREFIX}*`, proxy);
    }
  }),
);

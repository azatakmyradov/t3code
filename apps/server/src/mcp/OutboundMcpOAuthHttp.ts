// @effect-diagnostics nodeBuiltinImport:off -- This Node transport pins vetted DNS addresses while preserving TLS hostname verification and streaming responses.
import * as NodeDnsPromises from "node:dns/promises";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeNet from "node:net";
import * as NodeStream from "node:stream";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class OutboundMcpOAuthHttpError extends Schema.TaggedError<OutboundMcpOAuthHttpError>()(
  "OutboundMcpOAuthHttpError",
  {
    code: Schema.Literals(["unsafe_url", "network", "timeout", "redirect"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "The MCP OAuth endpoint could not be reached safely.";
  }
}

const isHttpError = Schema.is(OutboundMcpOAuthHttpError);

export interface OutboundMcpRequestInit {
  readonly method?: string;
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
  /** Trusted caller budget for response headers only; streaming bodies have no idle deadline. */
  readonly headerTimeoutMs?: number;
}

/** Only an explicit server-side development policy may allow local MCP endpoints. */
export const AllowLoopback = Context.Reference<boolean>("t3/mcp/OutboundOAuthAllowLoopback", {
  defaultValue: () => false,
});

export const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

/** Reject special-use addresses, including IPv4-mapped IPv6 and transition ranges. */
export const isPublicAddress = (address: string): boolean => {
  if (NodeNet.isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0]!;
    const b = octets[1]!;
    const c = octets[2]!;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (NodeNet.isIP(address) !== 6) return false;
  const parts = address.toLowerCase().split(":");
  const first = Number.parseInt(parts[0]!, 16);
  const second = Number.parseInt(parts[1] || "0", 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    !(first === 0x3fff && second < 0x1000)
  );
};

export const canonicalResourceUrl = (raw: string, allowLoopback = false): string => {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    raw.length > 4096 ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (allowLoopback && url.protocol === "http:" && isLoopbackHostname(url.hostname))
    ) ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    (NodeNet.isIP(hostname) !== 0 &&
      !isPublicAddress(hostname) &&
      !(allowLoopback && isLoopbackHostname(hostname)))
  ) {
    throw new OutboundMcpOAuthHttpError({ code: "unsafe_url" });
  }
  return url.href;
};

export class OutboundMcpOAuthHttp extends Context.Service<
  OutboundMcpOAuthHttp,
  {
    /** DNS is checked and pinned to this connection; redirects are never followed. */
    readonly fetch: (
      url: string,
      init?: OutboundMcpRequestInit,
    ) => Effect.Effect<Response, OutboundMcpOAuthHttpError>;
  }
>()("t3/mcp/OutboundMcpOAuthHttp") {}

const make = Effect.gen(function* () {
  const allowLoopback = yield* AllowLoopback;
  const fetch = Effect.fn("OutboundMcpOAuthHttp.fetch")(function* (
    raw: string,
    init: OutboundMcpRequestInit = {},
  ) {
    const url = yield* Effect.try({
      try: () => new URL(canonicalResourceUrl(raw, allowLoopback)),
      catch: (cause) => new OutboundMcpOAuthHttpError({ code: "unsafe_url", cause }),
    });
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses =
      NodeNet.isIP(hostname) !== 0
        ? [{ address: hostname, family: NodeNet.isIP(hostname) }]
        : yield* Effect.tryPromise({
            try: () => NodeDnsPromises.lookup(hostname, { all: true, verbatim: true }),
            catch: (cause) => new OutboundMcpOAuthHttpError({ code: "network", cause }),
          }).pipe(
            Effect.timeoutOrElse({
              duration: "5 seconds",
              orElse: () => Effect.fail(new OutboundMcpOAuthHttpError({ code: "timeout" })),
            }),
          );
    if (
      addresses.length === 0 ||
      addresses.some(
        ({ address }) =>
          !isPublicAddress(address) &&
          !(allowLoopback && isLoopbackHostname(hostname) && isLoopbackHostname(address)),
      )
    ) {
      return yield* new OutboundMcpOAuthHttpError({ code: "unsafe_url" });
    }
    const pinned = addresses[0]!;
    const timeoutMs = Math.min(
      300_000,
      Math.max(1_000, Number.isFinite(init.headerTimeoutMs) ? init.headerTimeoutMs! : 15_000),
    );
    return yield* Effect.tryPromise({
      try: (signal) =>
        new Promise<Response>((resolve, reject) => {
          const headers = new Headers(init.headers);
          // Callers cannot reroute a validated URL through a different HTTP Host.
          headers.delete("host");
          headers.set("accept-encoding", "identity");
          const request = (url.protocol === "https:" ? NodeHttps.request : NodeHttp.request)(
            url,
            {
              method: init.method ?? "GET",
              headers: Object.fromEntries(headers.entries()),
              agent: false,
              lookup: (_hostname, options, callback) =>
                options.all
                  ? callback(null, [pinned])
                  : callback(null, pinned.address, pinned.family),
              signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
              maxHeaderSize: 32 * 1024,
            },
            (incoming) => {
              try {
                request.setTimeout(0);
                const status = incoming.statusCode ?? 502;
                if (status < 200 || status > 599)
                  throw new OutboundMcpOAuthHttpError({ code: "network" });
                if (status >= 300 && status < 400) {
                  incoming.destroy();
                  reject(new OutboundMcpOAuthHttpError({ code: "redirect" }));
                  return;
                }
                const responseHeaders = new Headers();
                for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
                  responseHeaders.append(
                    incoming.rawHeaders[index]!,
                    incoming.rawHeaders[index + 1]!,
                  );
                }
                const noBody =
                  init.method === "HEAD" || status === 204 || status === 205 || status === 304;
                if (noBody) incoming.resume();
                const body = noBody
                  ? null
                  : (NodeStream.Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
                resolve(new Response(body, { status, headers: responseHeaders }));
              } catch (cause) {
                incoming.destroy();
                reject(cause);
              }
            },
          );
          request.setTimeout(timeoutMs, () =>
            request.destroy(new OutboundMcpOAuthHttpError({ code: "timeout" })),
          );
          request.on("upgrade", (_response, socket) => {
            socket.destroy();
            reject(new OutboundMcpOAuthHttpError({ code: "network" }));
          });
          request.on("error", reject);
          request.end(init.body);
        }),
      catch: (cause) =>
        isHttpError(cause) ? cause : new OutboundMcpOAuthHttpError({ code: "network", cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.fail(new OutboundMcpOAuthHttpError({ code: "timeout" })),
      }),
    );
  });
  return OutboundMcpOAuthHttp.of({ fetch });
});

export const layer = Layer.effect(OutboundMcpOAuthHttp, make);

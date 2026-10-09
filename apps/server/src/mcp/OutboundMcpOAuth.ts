import { parseOAuthScope } from "@t3tools/shared/oauthScope";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Http from "./OutboundMcpOAuthHttp.ts";

export class OutboundMcpOAuthError extends Schema.TaggedError<OutboundMcpOAuthError>()(
  "OutboundMcpOAuthError",
  {
    code: Schema.Literals([
      "invalid_binding",
      "unsafe_url",
      "discovery_failed",
      "unsupported",
      "registration_failed",
      "invalid_state",
      "cancelled",
      "denied",
      "token_failed",
      "not_connected",
      "expired",
      "storage",
      "network",
      "invalid_response",
      "too_many_flows",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.code) {
      case "unsupported":
        return "This MCP server does not support public-client OAuth with PKCE S256 and dynamic registration.";
      case "invalid_state":
        return "This connection attempt has expired or was already completed. Start a new connection.";
      case "cancelled":
        return "This connection attempt was cancelled or replaced.";
      case "denied":
        return "The OAuth authorization was not approved.";
      case "not_connected":
      case "expired":
        return "Connect this MCP server again to continue.";
      case "unsafe_url":
        return "The MCP OAuth endpoint is not an allowed secure public URL.";
      case "storage":
        return "The MCP connection could not be saved securely.";
      default:
        return "The MCP OAuth connection could not be completed.";
    }
  }
}

const isOAuthError = Schema.is(OutboundMcpOAuthError);

const Binding = Schema.Struct({ owner: Schema.String, name: Schema.String, url: Schema.String });
export type McpOAuthBinding = typeof Binding.Type;
const TrustProfile = Schema.Struct({
  resource: Schema.String,
  issuer: Schema.String,
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  registrationEndpoint: Schema.String,
  requestedScopes: Schema.Array(Schema.String),
});
export type McpOAuthStatus =
  | {
      readonly status: "disconnected" | "connecting" | "connected" | "expired";
      readonly flowId?: string;
      readonly expiresAt?: number;
    }
  | {
      readonly status: "trust-required";
      readonly flowId: string;
      readonly expiresAt: number;
      readonly profile: typeof TrustProfile.Type;
    };
const ResourceMetadata = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.Array(Schema.String),
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
  bearer_methods_supported: Schema.optional(Schema.Array(Schema.String)),
});
const AuthorizationMetadata = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optional(Schema.String),
  response_types_supported: Schema.Array(Schema.String),
  grant_types_supported: Schema.optional(Schema.Array(Schema.String)),
  code_challenge_methods_supported: Schema.optional(Schema.Array(Schema.String)),
  token_endpoint_auth_methods_supported: Schema.optional(Schema.Array(Schema.String)),
  authorization_response_iss_parameter_supported: Schema.optional(Schema.Boolean),
});
const Registration = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optional(Schema.String),
  token_endpoint_auth_method: Schema.optional(Schema.String),
  redirect_uris: Schema.optional(Schema.Array(Schema.String)),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
});
const OAuthFailure = Schema.Struct({ error: Schema.optional(Schema.String) });
const StoredGrant = Schema.Struct({
  version: Schema.Literal(1),
  binding: Binding,
  issuer: Schema.String,
  tokenEndpoint: Schema.String,
  clientId: Schema.String,
  redirectUri: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
  authorizationProfile: Schema.optional(TrustProfile),
  issuerIdentification: Schema.optional(Schema.Literals(["verified", "user-reviewed"])),
});
type StoredGrant = typeof StoredGrant.Type;
const decodeStoredGrant = Schema.decodeEffect(Schema.fromJsonString(StoredGrant));
const encodeStoredGrant = Schema.encodeEffect(Schema.fromJsonString(StoredGrant));
interface PendingReview {
  consumed?: boolean;
  readonly key: string;
  readonly binding: McpOAuthBinding;
  readonly generation: number;
  readonly flowId: string;
  readonly expiresAt: number;
  readonly redirectUri: string;
  readonly profile: typeof TrustProfile.Type;
  readonly fingerprint: string;
}
interface PendingFlow {
  readonly flowId: string;
  readonly profile: typeof TrustProfile.Type;
  readonly reviewed: boolean;
  consumed?: boolean;
  readonly key: string;
  readonly binding: McpOAuthBinding;
  readonly generation: number;
  readonly state: string;
  readonly expiresAt: number;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly metadata: typeof AuthorizationMetadata.Type;
}
const FLOW_TTL = 10 * 60 * 1000;
const MAX_BODY = 1024 * 1024;
// Removing a broken/now-disallowed config must never require contacting or trusting its URL.
const storageBinding = (binding: McpOAuthBinding): McpOAuthBinding => {
  try {
    return { ...binding, url: new URL(binding.url).href };
  } catch {
    return binding;
  }
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export class OutboundMcpOAuth extends Context.Service<
  OutboundMcpOAuth,
  {
    readonly begin: (input: {
      readonly binding: McpOAuthBinding;
      readonly redirectUri: string;
      readonly approvedReviewId?: string;
    }) => Effect.Effect<
      | {
          readonly _tag: "authorization";
          readonly authorizationUrl: string;
          readonly state: string;
          readonly flowId: string;
          readonly expiresAt: number;
        }
      | {
          readonly _tag: "trust-required";
          readonly flowId: string;
          readonly expiresAt: number;
          readonly profile: typeof TrustProfile.Type;
        },
      OutboundMcpOAuthError
    >;
    readonly pendingBinding: (
      state: string,
    ) => Effect.Effect<McpOAuthBinding, OutboundMcpOAuthError>;
    readonly complete: (input: {
      readonly state: string;
      readonly code?: string;
      readonly error?: string;
      readonly issuer?: string;
    }) => Effect.Effect<
      {
        readonly binding: McpOAuthBinding;
        readonly flowId: string;
      },
      OutboundMcpOAuthError
    >;
    readonly status: (
      binding: McpOAuthBinding,
    ) => Effect.Effect<McpOAuthStatus, OutboundMcpOAuthError>;
    readonly cancel: (
      binding: McpOAuthBinding,
      flowId?: string,
    ) => Effect.Effect<void, OutboundMcpOAuthError>;
    readonly disconnect: (binding: McpOAuthBinding) => Effect.Effect<void, OutboundMcpOAuthError>;
    /** Tokens never cross the client/provider boundary; only the local authenticated proxy uses this. */
    readonly getAccessToken: (
      binding: McpOAuthBinding,
      options?: { readonly forceRefresh?: boolean; readonly rejectedToken?: string },
    ) => Effect.Effect<string, OutboundMcpOAuthError>;
    readonly authorizedFetch: (
      binding: McpOAuthBinding,
      init?: Http.OutboundMcpRequestInit,
    ) => Effect.Effect<Response, OutboundMcpOAuthError>;
  }
>()("t3/mcp/OutboundMcpOAuth") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const http = yield* Http.OutboundMcpOAuthHttp;
  const crypto = yield* Crypto.Crypto;
  const allowLoopback = yield* Http.AllowLoopback;
  const flows = new Map<string, PendingFlow>();
  const reviews = new Map<string, PendingReview>();
  const generations = new Map<string, number>();
  const locks = new Map<string, Semaphore.Semaphore>();
  const lockFor = (key: string) => {
    let lock = locks.get(key);
    if (!lock) {
      lock = Semaphore.makeUnsafe(1);
      locks.set(key, lock);
    }
    return lock;
  };
  const safeUrl = (url: string) =>
    Effect.try({
      try: () => Http.canonicalResourceUrl(url, allowLoopback),
      catch: (cause) => new OutboundMcpOAuthError({ code: "unsafe_url", cause }),
    });
  const normalize = Effect.fnUntraced(function* (binding: McpOAuthBinding) {
    if (
      !binding.owner ||
      binding.owner.length > 1024 ||
      !binding.name ||
      binding.name.length > 256
    ) {
      return yield* new OutboundMcpOAuthError({ code: "invalid_binding" });
    }
    return { ...binding, url: yield* safeUrl(binding.url) };
  });
  const keyFor = Effect.fnUntraced(function* (binding: McpOAuthBinding) {
    const serialized = yield* encodeJson([binding.owner, binding.name, binding.url]).pipe(
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "invalid_binding", cause })),
    );
    return `mcp-oauth-${yield* crypto.digest("SHA-256", encoder.encode(serialized)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
    )}`;
  });
  const cleanFlows = (now: number) => {
    for (const [state, flow] of flows)
      if (flow.expiresAt <= now && !flow.consumed) flows.delete(state);
    for (const [id, review] of reviews)
      if (review.expiresAt <= now && !review.consumed) reviews.delete(id);
  };
  const invalidate = (key: string) => {
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    for (const [state, flow] of flows) if (flow.key === key) flows.delete(state);
    for (const [id, review] of reviews) if (review.key === key) reviews.delete(id);
    return generation;
  };
  const assertGeneration = (key: string, generation: number) =>
    generations.get(key) === generation
      ? Effect.void
      : Effect.fail(new OutboundMcpOAuthError({ code: "cancelled" }));
  const remove = (key: string) =>
    secrets
      .remove(key)
      .pipe(Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })));
  const read = Effect.fnUntraced(function* (key: string, binding: McpOAuthBinding) {
    const value = yield* secrets
      .get(key)
      .pipe(Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })));
    if (Option.isNone(value)) return undefined;
    const grant = yield* decodeStoredGrant(decoder.decode(value.value)).pipe(
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
    );
    if (
      grant.binding.owner !== binding.owner ||
      grant.binding.name !== binding.name ||
      grant.binding.url !== binding.url
    ) {
      return yield* new OutboundMcpOAuthError({ code: "invalid_binding" });
    }
    return grant;
  });
  const save = Effect.fnUntraced(
    function* (key: string, grant: StoredGrant) {
      const encoded = yield* encodeStoredGrant(grant);
      yield* secrets.set(key, encoder.encode(encoded));
    },
    Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
  );
  const discard = (response: Response) =>
    Effect.promise(() => response.body?.cancel().catch(() => {}) ?? Promise.resolve());
  const request = (url: string, init?: Http.OutboundMcpRequestInit) =>
    http.fetch(url, init).pipe(
      Effect.mapError(
        (cause) =>
          new OutboundMcpOAuthError({
            code:
              cause.code === "unsafe_url" || cause.code === "redirect" ? "unsafe_url" : "network",
            cause,
          }),
      ),
    );
  const text = (response: Response) =>
    Effect.tryPromise({
      try: async (signal) => {
        if (!response.body) return "";
        const reader = response.body.getReader();
        const abort = () => {
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          let size = 0;
          const chunks: Uint8Array[] = [];
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > MAX_BODY) throw new OutboundMcpOAuthError({ code: "invalid_response" });
            chunks.push(chunk.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          return decoder.decode(bytes);
        } finally {
          signal.removeEventListener("abort", abort);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      },
      catch: (cause) => new OutboundMcpOAuthError({ code: "invalid_response", cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(new OutboundMcpOAuthError({ code: "network" })),
      }),
    );
  const json = <A, I>(response: Response, schema: Schema.Codec<A, I>) =>
    text(response).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))),
      Effect.mapError((cause) =>
        isOAuthError(cause)
          ? cause
          : new OutboundMcpOAuthError({ code: "invalid_response", cause }),
      ),
    );
  const discover = Effect.fnUntraced(function* (binding: McpOAuthBinding) {
    const resource = new URL(binding.url);
    // The challenge is authoritative when supplied. Otherwise try the RFC 9728 path and root.
    const probe = yield* request(binding.url, {
      headers: {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
    });
    const challenge = probe.headers.get("www-authenticate") ?? "";
    const challengeUrl = /(?:^|[,\s])resource_metadata\s*=\s*"([^"\r\n]+)"/i.exec(challenge)?.[1];
    yield* discard(probe);
    const path = resource.pathname === "/" ? "" : resource.pathname.replace(/\/$/, "");
    const resourceUrls = challengeUrl
      ? [yield* safeUrl(challengeUrl)]
      : [
          ...new Set([
            `${resource.origin}/.well-known/oauth-protected-resource${path}`,
            `${resource.origin}/.well-known/oauth-protected-resource`,
          ]),
        ];
    let resourceMetadata: typeof ResourceMetadata.Type | undefined;
    for (const url of resourceUrls) {
      const response = yield* request(url, { headers: { Accept: "application/json" } });
      if (response.status === 404 && !challengeUrl) {
        yield* discard(response);
        continue;
      }
      if (!response.ok) {
        yield* discard(response);
        return yield* new OutboundMcpOAuthError({ code: "discovery_failed" });
      }
      resourceMetadata = yield* json(response, ResourceMetadata);
      break;
    }
    if (
      !resourceMetadata ||
      (yield* safeUrl(resourceMetadata.resource)) !== binding.url ||
      resourceMetadata.authorization_servers.length === 0 ||
      resourceMetadata.authorization_servers.length > 16 ||
      (resourceMetadata.bearer_methods_supported &&
        !resourceMetadata.bearer_methods_supported.includes("header"))
    ) {
      return yield* new OutboundMcpOAuthError({ code: "discovery_failed" });
    }
    const issuerString = resourceMetadata.authorization_servers[0]!;
    const issuer = new URL(yield* safeUrl(issuerString));
    if (issuer.search) return yield* new OutboundMcpOAuthError({ code: "discovery_failed" });
    const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
    const discoveryUrls = [
      ...new Set([
        `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
        `${issuer.origin}/.well-known/openid-configuration${issuerPath}`,
        `${issuer.origin}${issuerPath}/.well-known/openid-configuration`,
      ]),
    ];
    let metadata: typeof AuthorizationMetadata.Type | undefined;
    for (const url of discoveryUrls) {
      const response = yield* request(url, { headers: { Accept: "application/json" } });
      if (response.status === 404) {
        yield* discard(response);
        continue;
      }
      if (!response.ok) {
        yield* discard(response);
        return yield* new OutboundMcpOAuthError({ code: "discovery_failed" });
      }
      metadata = yield* json(response, AuthorizationMetadata);
      break;
    }
    // Issuer comparison is exact per RFC 8414; URL normalization must not erase tenant distinctions.
    if (!metadata || metadata.issuer !== issuerString)
      return yield* new OutboundMcpOAuthError({ code: "discovery_failed" });
    if (
      !metadata.registration_endpoint ||
      !metadata.response_types_supported.includes("code") ||
      !metadata.code_challenge_methods_supported?.includes("S256") ||
      (metadata.grant_types_supported &&
        !metadata.grant_types_supported.includes("authorization_code")) ||
      (metadata.token_endpoint_auth_methods_supported &&
        !metadata.token_endpoint_auth_methods_supported.includes("none"))
    ) {
      return yield* new OutboundMcpOAuthError({ code: "unsupported" });
    }
    yield* safeUrl(metadata.authorization_endpoint);
    yield* safeUrl(metadata.token_endpoint);
    yield* safeUrl(metadata.registration_endpoint);
    const requestedScope = /(?:^|[,\s])scope\s*=\s*"([^"\r\n]*)"/i.exec(challenge)?.[1];
    const scopes =
      requestedScope === undefined
        ? (resourceMetadata.scopes_supported ?? [])
        : parseOAuthScope(requestedScope);
    if (!scopes) return yield* new OutboundMcpOAuthError({ code: "invalid_response" });
    if (
      scopes.length > 64 ||
      scopes.some((scope) => !/^[\x21\x23-\x5b\x5d-\x7e]{1,256}$/.test(scope))
    ) {
      return yield* new OutboundMcpOAuthError({ code: "invalid_response" });
    }
    return { metadata, scopes };
  });
  const tokenExchange = Effect.fnUntraced(function* (endpoint: string, body: URLSearchParams) {
    const response = yield* request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!response.ok) {
      const failure = yield* json(response, OAuthFailure).pipe(
        Effect.orElseSucceed(() => ({ error: undefined })),
      );
      return yield* new OutboundMcpOAuthError({
        code: failure.error === "invalid_grant" ? "expired" : "token_failed",
      });
    }
    const token = yield* json(response, TokenResponse);
    if (
      !token.access_token ||
      token.access_token.length > 32768 ||
      !/^[\x21-\x7e]+$/.test(token.access_token) ||
      token.token_type.toLowerCase() !== "bearer" ||
      (token.refresh_token !== undefined &&
        (!token.refresh_token || token.refresh_token.length > 32768)) ||
      (token.expires_in !== undefined &&
        (!Number.isFinite(token.expires_in) ||
          token.expires_in <= 0 ||
          token.expires_in > 31_536_000))
    ) {
      return yield* new OutboundMcpOAuthError({ code: "invalid_response" });
    }
    return token;
  });
  const authorize = Effect.fnUntraced(function* (setup: {
    readonly binding: McpOAuthBinding;
    readonly key: string;
    readonly generation: number;
    readonly redirectUri: string;
    readonly metadata: typeof AuthorizationMetadata.Type;
    readonly profile: typeof TrustProfile.Type;
    readonly reviewed: boolean;
    readonly flowId?: string;
  }) {
    const { binding, key, generation, redirectUri, metadata, profile, reviewed } = setup;
    const scopes = profile.requestedScopes;
    const body = yield* encodeJson({
      client_name: "T3 Code",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types:
        metadata.grant_types_supported && !metadata.grant_types_supported.includes("refresh_token")
          ? ["authorization_code"]
          : ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }).pipe(
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "registration_failed", cause })),
    );
    yield* assertGeneration(key, generation);
    const registrationResponse = yield* request(metadata.registration_endpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    });
    if (!registrationResponse.ok) {
      yield* discard(registrationResponse);
      return yield* new OutboundMcpOAuthError({ code: "registration_failed" });
    }
    const registration = yield* json(registrationResponse, Registration);
    if (
      !registration.client_id ||
      registration.client_id.length > 4096 ||
      registration.client_secret ||
      (registration.token_endpoint_auth_method &&
        registration.token_endpoint_auth_method !== "none") ||
      (registration.redirect_uris &&
        (registration.redirect_uris.length !== 1 || registration.redirect_uris[0] !== redirectUri))
    ) {
      return yield* new OutboundMcpOAuthError({ code: "registration_failed" });
    }
    const verifier = yield* crypto.randomBytes(32).pipe(
      Effect.map(Base64Url.encode),
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
    );
    const challenge = yield* crypto.digest("SHA-256", encoder.encode(verifier)).pipe(
      Effect.map(Base64Url.encode),
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
    );
    const state = yield* crypto.randomBytes(32).pipe(
      Effect.map(Base64Url.encode),
      Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
    );
    const expiresAt = (yield* Clock.currentTimeMillis) + FLOW_TTL;
    if (generations.get(key) !== generation)
      return yield* new OutboundMcpOAuthError({ code: "cancelled" });
    if (flows.size + reviews.size - (setup.flowId && reviews.has(setup.flowId) ? 1 : 0) >= 64) {
      return yield* new OutboundMcpOAuthError({ code: "too_many_flows" });
    }
    const flowId = setup.flowId ?? state;
    flows.set(state, {
      key,
      binding,
      generation,
      state,
      flowId,
      profile,
      reviewed,
      expiresAt,
      verifier,
      redirectUri,
      clientId: registration.client_id,
      metadata,
    });
    const authorization = new URL(metadata.authorization_endpoint);
    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      resource: binding.url,
    }))
      authorization.searchParams.set(name, value);
    if (scopes.length) authorization.searchParams.set("scope", scopes.join(" "));
    else authorization.searchParams.delete("scope");
    return {
      _tag: "authorization" as const,
      authorizationUrl: authorization.href,
      state,
      flowId,
      expiresAt,
    };
  });
  const begin: OutboundMcpOAuth["Service"]["begin"] = Effect.fn("OutboundMcpOAuth.begin")(
    function* (input) {
      const binding = yield* normalize(input.binding);
      const redirectUri = yield* Effect.try({
        try: () => {
          const url = new URL(input.redirectUri);
          if (
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            input.redirectUri.length > 4096 ||
            !(
              url.protocol === "https:" ||
              (url.protocol === "http:" &&
                (Http.isLoopbackHostname(url.hostname) || url.hostname === "localhost"))
            )
          ) {
            throw new Error("Invalid callback URL");
          }
          return url.href;
        },
        catch: (cause) => new OutboundMcpOAuthError({ code: "unsafe_url", cause }),
      });
      const key = yield* keyFor(binding);
      cleanFlows(yield* Clock.currentTimeMillis);
      const approved =
        input.approvedReviewId === undefined ? undefined : reviews.get(input.approvedReviewId);
      if (
        input.approvedReviewId !== undefined &&
        (!approved ||
          approved.consumed ||
          approved.key !== key ||
          approved.redirectUri !== redirectUri ||
          approved.generation !== generations.get(key))
      ) {
        return yield* new OutboundMcpOAuthError({ code: "invalid_state" });
      }
      if (approved) approved.consumed = true;
      const generation = approved?.generation ?? invalidate(key);
      return yield* Effect.gen(function* () {
        if (flows.size + reviews.size - (approved ? 1 : 0) >= 64)
          return yield* new OutboundMcpOAuthError({ code: "too_many_flows" });
        if (!approved) yield* lockFor(key).withPermit(remove(key));
        const { metadata, scopes } = yield* discover(binding);
        yield* assertGeneration(key, generation);
        const profile: typeof TrustProfile.Type = {
          resource: binding.url,
          issuer: metadata.issuer,
          authorizationEndpoint: metadata.authorization_endpoint,
          tokenEndpoint: metadata.token_endpoint,
          registrationEndpoint: metadata.registration_endpoint!,
          requestedScopes: scopes,
        };
        // A review also pins callback policy and other relevant discovered metadata. It grants
        // per-connection trust in this authorization server, not cryptographic issuer verification.
        const fingerprint = yield* encodeJson({ profile, metadata, redirectUri }).pipe(
          Effect.mapError(
            (cause) => new OutboundMcpOAuthError({ code: "invalid_response", cause }),
          ),
        );
        if (
          (approved && approved.fingerprint !== fingerprint) ||
          (!approved && !metadata.authorization_response_iss_parameter_supported)
        ) {
          const flowId = yield* crypto.randomBytes(32).pipe(
            Effect.map(Base64Url.encode),
            Effect.mapError((cause) => new OutboundMcpOAuthError({ code: "storage", cause })),
          );
          const expiresAt = (yield* Clock.currentTimeMillis) + FLOW_TTL;
          if (generations.get(key) !== generation)
            return yield* new OutboundMcpOAuthError({ code: "cancelled" });
          if (flows.size + reviews.size - (approved ? 1 : 0) >= 64)
            return yield* new OutboundMcpOAuthError({ code: "too_many_flows" });
          reviews.set(flowId, {
            key,
            binding,
            generation,
            flowId,
            expiresAt,
            redirectUri,
            profile,
            fingerprint,
          });
          return { _tag: "trust-required" as const, flowId, expiresAt, profile };
        }
        return yield* authorize({
          binding,
          key,
          generation,
          redirectUri,
          metadata,
          profile,
          reviewed: approved !== undefined,
          ...(approved ? { flowId: approved.flowId } : {}),
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (approved && reviews.get(approved.flowId) === approved)
              reviews.delete(approved.flowId);
          }),
        ),
      );
    },
  );
  const pendingFlow = Effect.fnUntraced(function* (state: string) {
    cleanFlows(yield* Clock.currentTimeMillis);
    const flow = flows.get(state);
    if (!flow || flow.consumed) return yield* new OutboundMcpOAuthError({ code: "invalid_state" });
    yield* assertGeneration(flow.key, flow.generation);
    return flow;
  });
  const pendingBinding = Effect.fn("OutboundMcpOAuth.pendingBinding")(function* (state: string) {
    return (yield* pendingFlow(state)).binding;
  });
  const complete: OutboundMcpOAuth["Service"]["complete"] = Effect.fn("OutboundMcpOAuth.complete")(
    function* (input) {
      const flow = yield* pendingFlow(input.state);
      // Consume before any I/O, including denial: concurrent callbacks cannot exchange twice.
      flow.consumed = true;
      return yield* Effect.gen(function* () {
        if (
          (input.issuer !== undefined && input.issuer !== flow.metadata.issuer) ||
          ((!flow.reviewed || flow.metadata.authorization_response_iss_parameter_supported) &&
            input.issuer !== flow.metadata.issuer)
        ) {
          return yield* new OutboundMcpOAuthError({ code: "invalid_response" });
        }
        if (input.error) return yield* new OutboundMcpOAuthError({ code: "denied" });
        if (!input.code || input.code.length > 8192) {
          return yield* new OutboundMcpOAuthError({ code: "invalid_response" });
        }
        const token = yield* tokenExchange(
          flow.metadata.token_endpoint,
          new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: flow.redirectUri,
            client_id: flow.clientId,
            code_verifier: flow.verifier,
            resource: flow.binding.url,
          }),
        );
        const now = yield* Clock.currentTimeMillis;
        yield* lockFor(flow.key).withPermit(
          Effect.gen(function* () {
            yield* assertGeneration(flow.key, flow.generation);
            yield* save(flow.key, {
              version: 1,
              binding: flow.binding,
              issuer: flow.metadata.issuer,
              tokenEndpoint: flow.metadata.token_endpoint,
              clientId: flow.clientId,
              redirectUri: flow.redirectUri,
              authorizationProfile: flow.profile,
              issuerIdentification: flow.metadata.authorization_response_iss_parameter_supported
                ? "verified"
                : "user-reviewed",
              accessToken: token.access_token,
              ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
              ...(token.expires_in !== undefined
                ? { expiresAt: now + token.expires_in * 1000 }
                : {}),
              ...(token.scope !== undefined ? { scope: token.scope } : {}),
            });
            yield* assertGeneration(flow.key, flow.generation);
          }).pipe(Effect.uninterruptible),
        );
        return { binding: flow.binding, flowId: flow.flowId };
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (flows.get(input.state) === flow) flows.delete(input.state);
          }),
        ),
      );
    },
  );
  const status: OutboundMcpOAuth["Service"]["status"] = Effect.fn("OutboundMcpOAuth.status")(
    function* (input) {
      const binding = yield* normalize(input);
      const key = yield* keyFor(binding);
      const now = yield* Clock.currentTimeMillis;
      cleanFlows(now);
      for (const flow of flows.values())
        if (flow.key === key)
          return { status: "connecting", flowId: flow.flowId, expiresAt: flow.expiresAt };
      for (const review of reviews.values()) {
        if (review.key !== key) continue;
        if (review.consumed)
          return { status: "connecting", flowId: review.flowId, expiresAt: review.expiresAt };
        return {
          status: "trust-required",
          flowId: review.flowId,
          expiresAt: review.expiresAt,
          profile: review.profile,
        };
      }
      const grant = yield* lockFor(key).withPermit(read(key, binding));
      if (!grant) return { status: "disconnected" };
      return {
        status:
          grant.expiresAt !== undefined && grant.expiresAt <= now && !grant.refreshToken
            ? "expired"
            : "connected",
        ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
      };
    },
  );
  const cancel: OutboundMcpOAuth["Service"]["cancel"] = Effect.fn("OutboundMcpOAuth.cancel")(
    function* (input, flowId) {
      const binding = storageBinding(input);
      const key = yield* keyFor(binding);
      const matchingFlows = [...flows.values()].filter((flow) => flow.key === key);
      const matchingReviews = [...reviews.values()].filter((review) => review.key === key);
      if (
        flowId !== undefined &&
        !matchingFlows.some((flow) => flow.flowId === flowId) &&
        !matchingReviews.some((review) => review.flowId === flowId)
      )
        return;
      const hasFlow = matchingFlows.length > 0 || matchingReviews.length > 0;
      invalidate(key);
      if (!hasFlow) return;
      yield* lockFor(key).withPermit(remove(key)).pipe(Effect.uninterruptible);
    },
  );
  const disconnect = Effect.fn("OutboundMcpOAuth.disconnect")(function* (input: McpOAuthBinding) {
    const binding = storageBinding(input);
    const key = yield* keyFor(binding);
    invalidate(key);
    yield* lockFor(key).withPermit(remove(key)).pipe(Effect.uninterruptible);
  });
  const getAccessToken: OutboundMcpOAuth["Service"]["getAccessToken"] = Effect.fn(
    "OutboundMcpOAuth.getAccessToken",
  )(function* (input, options = {}) {
    const binding = yield* normalize(input);
    const key = yield* keyFor(binding);
    return yield* lockFor(key).withPermit(
      Effect.gen(function* () {
        const generation = generations.get(key) ?? 0;
        if (!generations.has(key)) generations.set(key, generation);
        const grant = yield* read(key, binding);
        if (!grant) return yield* new OutboundMcpOAuthError({ code: "not_connected" });
        const now = yield* Clock.currentTimeMillis;
        const rejected =
          options.forceRefresh &&
          (options.rejectedToken === undefined || options.rejectedToken === grant.accessToken);
        if (!rejected && (grant.expiresAt === undefined || grant.expiresAt > now + 30_000))
          return grant.accessToken;
        if (!grant.refreshToken) {
          if (!rejected && grant.expiresAt !== undefined && grant.expiresAt > now)
            return grant.accessToken;
          if (rejected) yield* save(key, { ...grant, expiresAt: now });
          return yield* new OutboundMcpOAuthError({ code: "expired" });
        }
        const token = yield* tokenExchange(
          grant.tokenEndpoint,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: grant.refreshToken,
            client_id: grant.clientId,
            resource: binding.url,
          }),
        ).pipe(
          Effect.catchTags({
            OutboundMcpOAuthError: (error) =>
              error.code === "expired"
                ? remove(key).pipe(Effect.andThen(Effect.fail(error)))
                : Effect.fail(error),
          }),
        );
        yield* assertGeneration(key, generation);
        const refreshedAt = yield* Clock.currentTimeMillis;
        const refreshed: StoredGrant = {
          version: 1,
          binding,
          issuer: grant.issuer,
          tokenEndpoint: grant.tokenEndpoint,
          clientId: grant.clientId,
          redirectUri: grant.redirectUri,
          ...(grant.authorizationProfile
            ? { authorizationProfile: grant.authorizationProfile }
            : {}),
          ...(grant.issuerIdentification
            ? { issuerIdentification: grant.issuerIdentification }
            : {}),
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? grant.refreshToken,
          ...(token.expires_in !== undefined
            ? { expiresAt: refreshedAt + token.expires_in * 1000 }
            : {}),
          ...(token.scope !== undefined
            ? { scope: token.scope }
            : grant.scope !== undefined
              ? { scope: grant.scope }
              : {}),
        };
        // Rotating refresh tokens must reach durable storage before any caller can use the new access token.
        yield* save(key, refreshed).pipe(Effect.uninterruptible);
        yield* assertGeneration(key, generation);
        return refreshed.accessToken;
      }),
    );
  });
  const authorizedFetch: OutboundMcpOAuth["Service"]["authorizedFetch"] = Effect.fn(
    "OutboundMcpOAuth.authorizedFetch",
  )(function* (input, init = {}) {
    const binding = yield* normalize(input);
    const accessToken = yield* getAccessToken(binding);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    const response = yield* request(binding.url, { ...init, headers, headerTimeoutMs: 120_000 });
    if (response.status !== 401) return response;
    yield* discard(response);
    const refreshed = yield* getAccessToken(binding, {
      forceRefresh: true,
      rejectedToken: accessToken,
    });
    headers.set("authorization", `Bearer ${refreshed}`);
    return yield* request(binding.url, { ...init, headers, headerTimeoutMs: 120_000 });
  });
  return OutboundMcpOAuth.of({
    begin,
    pendingBinding,
    complete,
    status,
    cancel,
    disconnect,
    getAccessToken,
    authorizedFetch,
  });
});

export const layer = Layer.effect(OutboundMcpOAuth, make);

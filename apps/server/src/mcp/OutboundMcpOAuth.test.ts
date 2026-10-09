import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Crypto from "effect/Crypto";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as OAuth from "./OutboundMcpOAuth.ts";
import * as Http from "./OutboundMcpOAuthHttp.ts";

const binding = { owner: "environment", name: "executor", url: "https://mcp.example.test/mcp" };
const issuer = "https://login.example.test/tenant";
const redirectUri = "https://remote.t3.example/api/mcp-oauth/callback";
const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const asMetadata = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  registration_endpoint: `${issuer}/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  authorization_response_iss_parameter_supported: true,
};
interface Call {
  readonly url: string;
  readonly init: Http.OutboundMcpRequestInit;
}
const harness = (
  options: {
    readonly secrets?: Map<string, Uint8Array>;
    readonly resource?: object;
    readonly metadata?: object;
    readonly registration?: object;
    readonly expiresIn?: number;
    readonly beforeSet?: () => Effect.Effect<void>;
    readonly respond?: (
      call: Call,
    ) => Effect.Effect<Response, Http.OutboundMcpOAuthHttpError> | undefined;
  } = {},
) => {
  const data = options.secrets ?? new Map<string, Uint8Array>();
  const calls: Call[] = [];
  let tokenCount = 0;
  const secrets = Secrets.ServerSecretStore.of({
    get: (key) => Effect.sync(() => Option.fromUndefinedOr(data.get(key))),
    set: (key, value) =>
      (options.beforeSet?.() ?? Effect.void).pipe(
        Effect.andThen(
          Effect.sync(() => {
            data.set(key, value);
          }),
        ),
      ),
    remove: (key) =>
      Effect.sync(() => {
        data.delete(key);
      }),
    create: () => Effect.die("unused"),
    getOrCreateRandom: () => Effect.die("unused"),
  });
  const network = Http.OutboundMcpOAuthHttp.of({
    fetch: (url, init = {}) =>
      Effect.suspend(() => {
        const call = { url, init: { ...init, headers: new Headers(init.headers) } };
        calls.push(call);
        const overridden = options.respond?.(call);
        if (overridden) return overridden;
        if (url === binding.url) return Effect.succeed(new Response(null, { status: 401 }));
        if (url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp")
          return Effect.succeed(
            jsonResponse(
              options.resource ?? {
                resource: binding.url,
                authorization_servers: [issuer],
                scopes_supported: ["tools:read"],
              },
            ),
          );
        if (url === "https://login.example.test/.well-known/oauth-authorization-server/tenant")
          return Effect.succeed(jsonResponse(options.metadata ?? asMetadata));
        if (url === `${issuer}/register`)
          return Effect.succeed(
            jsonResponse(
              options.registration ?? {
                client_id: "registered-public-client",
                token_endpoint_auth_method: "none",
                redirect_uris: [redirectUri],
              },
              201,
            ),
          );
        if (url === `${issuer}/token`) {
          tokenCount += 1;
          return Effect.succeed(
            jsonResponse({
              access_token: `access-${tokenCount}`,
              refresh_token: `refresh-${tokenCount}`,
              token_type: "Bearer",
              expires_in: tokenCount === 1 ? (options.expiresIn ?? 3600) : 3600,
            }),
          );
        }
        return Effect.succeed(new Response(null, { status: 404 }));
      }),
  });
  return {
    data,
    calls,
    layer: OAuth.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Secrets.ServerSecretStore, secrets),
          Layer.succeed(Http.OutboundMcpOAuthHttp, network),
          NodeCrypto.layer,
        ),
      ),
    ),
  };
};
const beginAuthorization = Effect.fnUntraced(function* (
  oauth: OAuth.OutboundMcpOAuth["Service"],
  input: Parameters<OAuth.OutboundMcpOAuth["Service"]["begin"]>[0] = { binding, redirectUri },
) {
  const flow = yield* oauth.begin(input);
  assert.strictEqual(flow._tag, "authorization");
  if (flow._tag !== "authorization") return yield* Effect.die("Expected authorization flow");
  return flow;
});
const beginReview = Effect.fnUntraced(function* (
  oauth: OAuth.OutboundMcpOAuth["Service"],
  input: Parameters<OAuth.OutboundMcpOAuth["Service"]["begin"]>[0] = { binding, redirectUri },
) {
  const review = yield* oauth.begin(input);
  assert.strictEqual(review._tag, "trust-required");
  if (review._tag !== "trust-required") return yield* Effect.die("Expected trust review");
  return review;
});
const connect = Effect.fnUntraced(function* (oauth: OAuth.OutboundMcpOAuth["Service"]) {
  const flow = yield* beginAuthorization(oauth);
  yield* oauth.complete({ state: flow.state, code: "authorization-code", issuer });
  return flow;
});

it.effect(
  "uses remote redirect, S256, single-use state and exact resource indicators, storing credentials only in ServerSecretStore",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      const flow = yield* beginAuthorization(oauth);
      const authorization = new URL(flow.authorizationUrl);
      assert.strictEqual(authorization.searchParams.get("redirect_uri"), redirectUri);
      assert.strictEqual(authorization.searchParams.get("resource"), binding.url);
      assert.strictEqual(authorization.searchParams.get("code_challenge_method"), "S256");
      assert.strictEqual(authorization.searchParams.get("scope"), "tools:read");
      assert.deepStrictEqual(yield* oauth.status(binding), {
        status: "connecting",
        flowId: flow.flowId,
        expiresAt: flow.expiresAt,
      });
      yield* oauth.complete({ state: flow.state, code: "authorization-code", issuer });
      const exchange = h.calls.find((call) => call.url.endsWith("/token"))!;
      const params = new URLSearchParams(String(exchange.init.body));
      assert.strictEqual(params.get("resource"), binding.url);
      assert.strictEqual(params.get("redirect_uri"), redirectUri);
      assert.strictEqual(
        yield* Effect.gen(function* () {
          const crypto = yield* Crypto.Crypto;
          return yield* crypto
            .digest("SHA-256", new TextEncoder().encode(params.get("code_verifier")!))
            .pipe(Effect.map(Base64Url.encode));
        }).pipe(Effect.provide(NodeCrypto.layer)),
        authorization.searchParams.get("code_challenge"),
      );
      assert.strictEqual(yield* oauth.getAccessToken(binding), "access-1");
      assert.strictEqual((yield* oauth.status(binding)).status, "connected");
      assert.strictEqual(h.data.size, 1);
      assert.match([...h.data.keys()][0]!, /^mcp-oauth-[a-f0-9]{64}$/);
      assert.strictEqual(
        (yield* oauth.complete({ state: flow.state, code: "again", issuer }).pipe(Effect.flip))
          .code,
        "invalid_state",
      );
      assert.strictEqual(
        (yield* oauth.status({ ...binding, owner: "project:another" })).status,
        "disconnected",
      );
      assert.strictEqual(
        (yield* oauth.status({ ...binding, name: "other" })).status,
        "disconnected",
      );
      assert.strictEqual(
        (yield* oauth.status({ ...binding, url: `${binding.url}/other` })).status,
        "disconnected",
      );
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect.each([
  [
    "resource mismatch",
    { resource: { resource: `${binding.url}/other`, authorization_servers: [issuer] } },
    "discovery_failed",
  ],
  [
    "issuer mismatch",
    { metadata: { ...asMetadata, issuer: "https://other.example.test" } },
    "discovery_failed",
  ],
  [
    "missing S256",
    { metadata: { ...asMetadata, code_challenge_methods_supported: ["plain"] } },
    "unsupported",
  ],
  [
    "confidential registration",
    { registration: { client_id: "client", client_secret: "secret" } },
    "registration_failed",
  ],
  [
    "changed registered redirect",
    {
      registration: {
        client_id: "client",
        redirect_uris: ["https://attacker.example.test/callback"],
      },
    },
    "registration_failed",
  ],
] as const)("rejects %s", ([_name, options, code]) => {
  const h = harness(options);
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const error = yield* oauth.begin({ binding, redirectUri }).pipe(Effect.flip);
    assert.strictEqual(error.code, code);
    assert.strictEqual(h.data.size, 0);
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "expires state and rejects denial, absent issuer and issuer mix-up without exchanging a token",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      const flow = yield* beginAuthorization(oauth);
      yield* TestClock.adjust("11 minutes");
      assert.strictEqual(
        (yield* oauth.complete({ state: flow.state, code: "code", issuer }).pipe(Effect.flip)).code,
        "invalid_state",
      );
      for (const response of [
        { error: "access_denied" },
        { code: "code" },
        { code: "code", issuer: "https://attacker.example.test" },
      ]) {
        const next = yield* beginAuthorization(oauth);
        yield* oauth.complete({ state: next.state, ...response }).pipe(Effect.flip);
      }
      assert.strictEqual(h.calls.filter((call) => call.url.endsWith("/token")).length, 0);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect(
  "coalesces refresh rotation across concurrent requests and persists the rotated refresh token across service restart",
  () => {
    const h = harness({ expiresIn: 1 });
    return Effect.gen(function* () {
      const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
      yield* connect(oauth);
      const tokens = yield* Effect.all(
        Array.from({ length: 8 }, () => oauth.getAccessToken(binding)),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(tokens, Array(8).fill("access-2"));
      assert.strictEqual(h.calls.filter((call) => call.url.endsWith("/token")).length, 2);
      const h2 = harness({ secrets: h.data });
      const restarted = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(
        Effect.provide(h2.layer),
      );
      assert.strictEqual(yield* restarted.getAccessToken(binding), "access-2");
      yield* restarted.getAccessToken(binding, { forceRefresh: true, rejectedToken: "access-2" });
      const refresh = h2.calls.find((call) => call.url.endsWith("/token"))!;
      assert.strictEqual(
        new URLSearchParams(String(refresh.init.body)).get("refresh_token"),
        "refresh-2",
      );
      assert.strictEqual(
        new URLSearchParams(String(refresh.init.body)).get("resource"),
        binding.url,
      );
      yield* restarted.disconnect(binding);
      assert.strictEqual(h.data.size, 0);
      assert.strictEqual((yield* restarted.status(binding)).status, "disconnected");
    });
  },
);

it.effect("cancels an in-flight callback and does not let a stale cancel close a newer flow", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const h = harness({
      respond: ({ url }) =>
        url.endsWith("/token")
          ? Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(
                jsonResponse({
                  access_token: "late-token",
                  token_type: "Bearer",
                  expires_in: 3600,
                }),
              ),
            )
          : undefined,
    });
    const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
    const flow = yield* beginAuthorization(oauth);
    const completion = yield* oauth
      .complete({ state: flow.state, code: "code", issuer })
      .pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(started);
    assert.strictEqual(
      (yield* oauth.complete({ state: flow.state, code: "duplicate", issuer }).pipe(Effect.flip))
        .code,
      "invalid_state",
    );
    yield* oauth.cancel(binding, flow.flowId);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(completion);
    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(h.data.size, 0);
    const next = yield* beginAuthorization(oauth);
    yield* oauth.cancel(binding, flow.flowId);
    assert.strictEqual((yield* oauth.status(binding)).flowId, next.flowId);
    yield* oauth.cancel(binding, next.flowId);
    assert.strictEqual((yield* oauth.status(binding)).status, "disconnected");
  }),
);

it.effect(
  "forwards only resource-bound bearer credentials and refreshes a 401 exactly once",
  () => {
    let authenticatedRequests = 0;
    const h = harness({
      respond: ({ url, init }) => {
        if (url !== binding.url || !new Headers(init.headers).has("authorization"))
          return undefined;
        authenticatedRequests += 1;
        return Effect.succeed(
          new Response(authenticatedRequests === 2 ? "event: message\ndata: {}\n\n" : null, {
            status: authenticatedRequests === 2 ? 200 : 401,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    });
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      yield* connect(oauth);
      const response = yield* oauth.authorizedFetch(binding, {
        method: "POST",
        headers: { authorization: "untrusted", "content-type": "application/json" },
        body: "{}",
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        yield* Effect.promise(() => response.text()),
        "event: message\ndata: {}\n\n",
      );
      const calls = h.calls.filter(
        (call) => call.url === binding.url && new Headers(call.init.headers).has("authorization"),
      );
      assert.deepStrictEqual(
        calls.map((call) => new Headers(call.init.headers).get("authorization")),
        ["Bearer access-1", "Bearer access-2"],
      );
      assert.strictEqual(authenticatedRequests, 2);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("supports challenge metadata and well-known root/OIDC fallback discovery", () => {
  const h = harness({
    respond: ({ url }) => {
      if (url === binding.url)
        return Effect.succeed(
          new Response(null, {
            status: 401,
            headers: {
              "www-authenticate":
                'Bearer resource_metadata="https://metadata.example.test/resource"',
            },
          }),
        );
      if (url === "https://metadata.example.test/resource")
        return Effect.succeed(
          jsonResponse({ resource: binding.url, authorization_servers: [issuer] }),
        );
      if (
        url === "https://login.example.test/.well-known/oauth-authorization-server/tenant" ||
        url === "https://login.example.test/.well-known/openid-configuration/tenant"
      )
        return Effect.succeed(new Response(null, { status: 404 }));
      if (url === `${issuer}/.well-known/openid-configuration`)
        return Effect.succeed(jsonResponse(asMetadata));
      return undefined;
    },
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    yield* connect(oauth);
    assert.isTrue(h.calls.some(({ url }) => url === "https://metadata.example.test/resource"));
    assert.isFalse(h.calls.some(({ url }) => url.includes("oauth-protected-resource")));
    assert.isTrue(h.calls.some(({ url }) => url === `${issuer}/.well-known/openid-configuration`));
  }).pipe(Effect.provide(h.layer));
});

it.effect("uses challenged scopes instead of requesting every advertised scope", () => {
  const h = harness({
    resource: {
      resource: binding.url,
      authorization_servers: [issuer],
      scopes_supported: ["read", "admin"],
    },
    respond: ({ url }) =>
      url === binding.url
        ? Effect.succeed(
            new Response(null, {
              status: 401,
              headers: { "www-authenticate": 'Bearer scope="read"' },
            }),
          )
        : undefined,
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const flow = yield* beginAuthorization(oauth);
    assert.strictEqual(new URL(flow.authorizationUrl).searchParams.get("scope"), "read");
  }).pipe(Effect.provide(h.layer));
});

it.effect("uses resource-root metadata fallback and accepts exact localhost callback", () => {
  const localRedirect = "http://localhost:3773/api/mcp-oauth/callback";
  const h = harness({
    registration: { client_id: "client", redirect_uris: [localRedirect] },
    respond: ({ url }) => {
      if (url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp")
        return Effect.succeed(new Response(null, { status: 404 }));
      if (url === "https://mcp.example.test/.well-known/oauth-protected-resource")
        return Effect.succeed(
          jsonResponse({ resource: binding.url, authorization_servers: [issuer] }),
        );
      return undefined;
    },
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const flow = yield* beginAuthorization(oauth, { binding, redirectUri: localRedirect });
    assert.strictEqual(
      new URL(flow.authorizationUrl).searchParams.get("redirect_uri"),
      localRedirect,
    );
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "removes invalid refresh grants and preserves credentials on transient token failure",
  () => {
    let failureStatus = 503;
    const h = harness({
      respond: ({ url, init }) =>
        url.endsWith("/token") &&
        new URLSearchParams(String(init.body)).get("grant_type") === "refresh_token"
          ? Effect.succeed(
              jsonResponse(
                {
                  error: failureStatus === 400 ? "invalid_grant" : "temporarily_unavailable",
                  error_description: "secret diagnostic",
                },
                failureStatus,
              ),
            )
          : undefined,
    });
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      yield* connect(oauth);
      const transient = yield* oauth
        .getAccessToken(binding, { forceRefresh: true })
        .pipe(Effect.flip);
      assert.strictEqual(transient.code, "token_failed");
      assert.notInclude(transient.message, "secret diagnostic");
      assert.strictEqual(h.data.size, 1);
      failureStatus = 400;
      assert.strictEqual(
        (yield* oauth.getAccessToken(binding, { forceRefresh: true }).pipe(Effect.flip)).code,
        "expired",
      );
      assert.strictEqual(h.data.size, 0);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("rejects oversized metadata bodies before registering a client", () => {
  const h = harness({
    respond: ({ url }) =>
      url.includes("oauth-protected-resource")
        ? Effect.succeed(new Response(" ".repeat(1024 * 1024 + 1)))
        : undefined,
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    assert.strictEqual(
      (yield* oauth.begin({ binding, redirectUri }).pipe(Effect.flip)).code,
      "invalid_response",
    );
    assert.isFalse(h.calls.some(({ url }) => url.endsWith("/register")));
  }).pipe(Effect.provide(h.layer));
});

it.effect("disconnect wins against an in-flight rotating refresh", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const h = harness({
      respond: ({ url, init }) =>
        url.endsWith("/token") &&
        new URLSearchParams(String(init.body)).get("grant_type") === "refresh_token"
          ? Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(
                jsonResponse({
                  access_token: "late-access",
                  refresh_token: "rotated",
                  token_type: "Bearer",
                  expires_in: 3600,
                }),
              ),
            )
          : undefined,
    });
    const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
    yield* connect(oauth);
    const refresh = yield* oauth
      .getAccessToken(binding, { forceRefresh: true })
      .pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(started);
    const disconnect = yield* oauth.disconnect(binding).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(disconnect);
    yield* Fiber.join(refresh);
    assert.strictEqual(h.data.size, 0);
    assert.strictEqual((yield* oauth.status(binding)).status, "disconnected");
  }),
);

it.effect("cancel removes credentials even when persistence has already started", () =>
  Effect.gen(function* () {
    const saving = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const h = harness({
      beforeSet: () =>
        Deferred.succeed(saving, undefined).pipe(Effect.andThen(Deferred.await(release))),
    });
    const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
    const flow = yield* beginAuthorization(oauth);
    const completion = yield* oauth
      .complete({ state: flow.state, code: "code", issuer })
      .pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(saving);
    const cancellation = yield* oauth.cancel(binding, flow.flowId).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(cancellation);
    const result = yield* Fiber.join(completion);
    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(h.data.size, 0);
  }),
);

it.effect(
  "can disconnect invalid or newly disallowed config URLs without a network request",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      yield* oauth.disconnect({ ...binding, url: "http://192.168.1.2/mcp" });
      yield* oauth.disconnect({ ...binding, url: "not a URL" });
      yield* oauth.cancel({ ...binding, url: "not a URL" });
      yield* oauth.disconnect({ ...binding, url: "https://user:password@example.test/mcp" });
      assert.strictEqual(h.calls.length, 0);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("reports a rejected non-refreshable token as expired", () => {
  const h = harness({
    respond: ({ url }) =>
      url.endsWith("/token")
        ? Effect.succeed(jsonResponse({ access_token: "access", token_type: "Bearer" }))
        : undefined,
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    yield* connect(oauth);
    assert.strictEqual((yield* oauth.authorizedFetch(binding).pipe(Effect.flip)).code, "expired");
    assert.strictEqual((yield* oauth.status(binding)).status, "expired");
  }).pipe(Effect.provide(h.layer));
});

it.effect.each([false, undefined])(
  "requires deliberate trust review when issuer identification support is %s",
  (issuerSupport) => {
    const h = harness({
      metadata: { ...asMetadata, authorization_response_iss_parameter_supported: issuerSupport },
    });
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      const review = yield* beginReview(oauth);
      assert.deepStrictEqual(review.profile, {
        resource: binding.url,
        issuer,
        authorizationEndpoint: `${issuer}/authorize`,
        tokenEndpoint: `${issuer}/token`,
        registrationEndpoint: `${issuer}/register`,
        requestedScopes: ["tools:read"],
      });
      assert.deepStrictEqual(yield* oauth.status(binding), {
        status: "trust-required",
        flowId: review.flowId,
        expiresAt: review.expiresAt,
        profile: review.profile,
      });
      assert.isFalse("authorizationUrl" in review);
      assert.isFalse("state" in review);
      assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
      assert.strictEqual(
        (yield* oauth.pendingBinding(review.flowId).pipe(Effect.flip)).code,
        "invalid_state",
      );
      const flow = yield* beginAuthorization(oauth, {
        binding,
        redirectUri,
        approvedReviewId: review.flowId,
      });
      assert.strictEqual(flow.flowId, review.flowId);
      assert.notStrictEqual(flow.state, review.flowId);
      assert.strictEqual(h.calls.filter(({ url }) => url.endsWith("/register")).length, 1);
      yield* oauth.complete({ state: flow.state, code: "reviewed-code" });
      const stored = JSON.parse(new TextDecoder().decode([...h.data.values()][0]!));
      assert.deepStrictEqual(stored.authorizationProfile, review.profile);
      assert.strictEqual(stored.issuerIdentification, "user-reviewed");
      assert.strictEqual(yield* oauth.getAccessToken(binding), "access-1");
      assert.strictEqual(
        (yield* oauth
          .begin({ binding, redirectUri, approvedReviewId: review.flowId })
          .pipe(Effect.flip)).code,
        "invalid_state",
      );
      const reconnect = yield* beginReview(oauth);
      assert.notStrictEqual(reconnect.flowId, review.flowId);
      assert.strictEqual(h.calls.filter(({ url }) => url.endsWith("/register")).length, 1);
      assert.strictEqual(h.data.size, 0);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect.each(["cancel", "expire", "replace"] as const)(
  "rejects a review after %s without registering a client",
  (action) => {
    const h = harness({
      metadata: { ...asMetadata, authorization_response_iss_parameter_supported: false },
    });
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      const review = yield* beginReview(oauth);
      if (action === "cancel") yield* oauth.cancel(binding, review.flowId);
      if (action === "expire") yield* TestClock.adjust("10 minutes");
      if (action === "replace") yield* beginReview(oauth);
      assert.strictEqual(
        (yield* oauth
          .begin({ binding, redirectUri, approvedReviewId: review.flowId })
          .pipe(Effect.flip)).code,
        "invalid_state",
      );
      assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("binds reviews to the owner, resource, server name and callback", () => {
  const h = harness({
    metadata: { ...asMetadata, authorization_response_iss_parameter_supported: false },
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const review = yield* beginReview(oauth);
    for (const input of [
      { binding: { ...binding, owner: "project:other" }, redirectUri },
      { binding: { ...binding, name: "other" }, redirectUri },
      { binding: { ...binding, url: `${binding.url}/other` }, redirectUri },
      { binding, redirectUri: "https://other.t3.example/api/mcp-oauth/callback" },
    ]) {
      assert.strictEqual(
        (yield* oauth.begin({ ...input, approvedReviewId: review.flowId }).pipe(Effect.flip)).code,
        "invalid_state",
      );
    }
    assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
    const flow = yield* beginAuthorization(oauth, {
      binding,
      redirectUri,
      approvedReviewId: review.flowId,
    });
    yield* oauth.cancel(binding, review.flowId);
    assert.strictEqual((yield* oauth.status(binding)).status, "disconnected");
    assert.strictEqual(
      (yield* oauth.complete({ state: flow.state, code: "code" }).pipe(Effect.flip)).code,
      "invalid_state",
    );
  }).pipe(Effect.provide(h.layer));
});

it.effect.each([
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "registration_endpoint",
  "scopes",
  "issuer-support",
] as const)("requires a new review when rediscovery changes %s", (field) => {
  let changed = false;
  const nextIssuer = "https://identity.other.example.test/account";
  const changedEndpoint = "https://endpoint.other.example.test/oauth";
  const h = harness({
    respond: ({ url }) => {
      if (url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return Effect.succeed(
          jsonResponse({
            resource: binding.url,
            authorization_servers: [changed && field === "issuer" ? nextIssuer : issuer],
            scopes_supported:
              changed && field === "scopes" ? ["tools:read", "tools:write"] : ["tools:read"],
          }),
        );
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return Effect.succeed(
          jsonResponse({
            ...asMetadata,
            authorization_response_iss_parameter_supported: changed && field === "issuer-support",
            ...(changed && field === "issuer" ? { issuer: nextIssuer } : {}),
            ...(changed && field.endsWith("_endpoint") ? { [field]: changedEndpoint } : {}),
          }),
        );
      }
      return undefined;
    },
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const first = yield* beginReview(oauth);
    changed = true;
    const second = yield* beginReview(oauth, {
      binding,
      redirectUri,
      approvedReviewId: first.flowId,
    });
    assert.notStrictEqual(second.flowId, first.flowId);
    if (field === "issuer") assert.strictEqual(second.profile.issuer, nextIssuer);
    if (field === "authorization_endpoint")
      assert.strictEqual(second.profile.authorizationEndpoint, changedEndpoint);
    if (field === "token_endpoint")
      assert.strictEqual(second.profile.tokenEndpoint, changedEndpoint);
    if (field === "registration_endpoint")
      assert.strictEqual(second.profile.registrationEndpoint, changedEndpoint);
    if (field === "scopes")
      assert.deepStrictEqual(second.profile.requestedScopes, ["tools:read", "tools:write"]);
    assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
    assert.strictEqual(
      (yield* oauth
        .begin({ binding, redirectUri, approvedReviewId: first.flowId })
        .pipe(Effect.flip)).code,
      "invalid_state",
    );
    yield* oauth.cancel(binding, first.flowId);
    assert.strictEqual((yield* oauth.status(binding)).flowId, second.flowId);
  }).pipe(Effect.provide(h.layer));
});

it.effect.each([
  ["verified success without issuer", true, { code: "code" }, "invalid_response"],
  ["verified error without issuer", true, { error: "access_denied" }, "invalid_response"],
  [
    "verified error with wrong issuer",
    true,
    { error: "access_denied", issuer: `${issuer}/` },
    "invalid_response",
  ],
  ["verified error with exact issuer", true, { error: "access_denied", issuer }, "denied"],
  [
    "reviewed success with wrong issuer",
    false,
    { code: "code", issuer: `${issuer}/` },
    "invalid_response",
  ],
  [
    "reviewed error with wrong issuer",
    false,
    { error: "access_denied", issuer: `${issuer}/` },
    "invalid_response",
  ],
  ["reviewed error without issuer", false, { error: "access_denied" }, "denied"],
  ["reviewed error with exact issuer", false, { error: "access_denied", issuer }, "denied"],
] as const)(
  "validates callback issuer before processing %s",
  ([_name, issuerSupport, callback, code]) => {
    const h = harness({
      metadata: { ...asMetadata, authorization_response_iss_parameter_supported: issuerSupport },
    });
    return Effect.gen(function* () {
      const oauth = yield* OAuth.OutboundMcpOAuth;
      const review = issuerSupport ? undefined : yield* beginReview(oauth);
      const flow = yield* beginAuthorization(oauth, {
        binding,
        redirectUri,
        ...(review ? { approvedReviewId: review.flowId } : {}),
      });
      assert.strictEqual(
        (yield* oauth.complete({ state: flow.state, ...callback }).pipe(Effect.flip)).code,
        code,
      );
      assert.strictEqual(
        (yield* oauth.complete({ state: flow.state, code: "retry", issuer }).pipe(Effect.flip))
          .code,
        "invalid_state",
      );
      assert.isFalse(h.calls.some(({ url }) => url.endsWith("/token")));
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect(
  "pins reviewed cross-origin endpoints and preserves the profile when refreshing after restart",
  () => {
    const endpoints = {
      authorization_endpoint: "https://authorize.identity.example.test/start",
      token_endpoint: "https://tokens.identity.example.test/exchange",
      registration_endpoint: "https://registration.identity.example.test/client",
    };
    const metadata = {
      ...asMetadata,
      ...endpoints,
      authorization_response_iss_parameter_supported: false,
    };
    const h = harness({
      metadata,
      respond: ({ url }) => {
        if (url === endpoints.registration_endpoint)
          return Effect.succeed(jsonResponse({ client_id: "reviewed-client" }));
        if (url === endpoints.token_endpoint)
          return Effect.succeed(
            jsonResponse({
              access_token: "pinned-access",
              refresh_token: "pinned-refresh",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          );
        return undefined;
      },
    });
    return Effect.gen(function* () {
      const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
      const review = yield* beginReview(oauth);
      assert.deepStrictEqual(review.profile, {
        resource: binding.url,
        issuer,
        authorizationEndpoint: endpoints.authorization_endpoint,
        tokenEndpoint: endpoints.token_endpoint,
        registrationEndpoint: endpoints.registration_endpoint,
        requestedScopes: ["tools:read"],
      });
      assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
      const flow = yield* beginAuthorization(oauth, {
        binding,
        redirectUri,
        approvedReviewId: review.flowId,
      });
      assert.strictEqual(
        new URL(flow.authorizationUrl).origin,
        "https://authorize.identity.example.test",
      );
      yield* oauth.complete({ state: flow.state, code: "code", issuer });
      const restartedHarness = harness({
        secrets: h.data,
        metadata: { ...metadata, token_endpoint: "https://attacker.example.test/token" },
        respond: ({ url }) =>
          url === endpoints.token_endpoint
            ? Effect.succeed(
                jsonResponse({
                  access_token: "refreshed-access",
                  refresh_token: "rotated-refresh",
                  token_type: "Bearer",
                  expires_in: 3600,
                }),
              )
            : undefined,
      });
      const restarted = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(
        Effect.provide(restartedHarness.layer),
      );
      assert.strictEqual(
        yield* restarted.getAccessToken(binding, { forceRefresh: true }),
        "refreshed-access",
      );
      assert.deepStrictEqual(
        restartedHarness.calls.map(({ url }) => url),
        [endpoints.token_endpoint],
      );
      const params = new URLSearchParams(String(restartedHarness.calls[0]!.init.body));
      assert.strictEqual(params.get("refresh_token"), "pinned-refresh");
      assert.strictEqual(params.get("client_id"), "reviewed-client");
      assert.strictEqual(params.get("resource"), binding.url);
      const stored = JSON.parse(new TextDecoder().decode([...h.data.values()][0]!));
      assert.deepStrictEqual(stored.authorizationProfile, review.profile);
      assert.strictEqual(stored.issuerIdentification, "user-reviewed");
      assert.strictEqual(stored.tokenEndpoint, endpoints.token_endpoint);
      assert.strictEqual(stored.refreshToken, "rotated-refresh");
    });
  },
);

it.effect("consumes approval once and lets cancellation win during rediscovery", () =>
  Effect.gen(function* () {
    const rediscovering = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let approvalStarted = false;
    const h = harness({
      metadata: { ...asMetadata, authorization_response_iss_parameter_supported: false },
      respond: ({ url }) =>
        approvalStarted && url === binding.url
          ? Deferred.succeed(rediscovering, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(new Response(null, { status: 401 })),
            )
          : undefined,
    });
    const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
    const review = yield* beginReview(oauth);
    approvalStarted = true;
    const approval = yield* oauth
      .begin({ binding, redirectUri, approvedReviewId: review.flowId })
      .pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(rediscovering);
    assert.strictEqual((yield* oauth.status(binding)).flowId, review.flowId);
    assert.strictEqual(
      (yield* oauth
        .begin({ binding, redirectUri, approvedReviewId: review.flowId })
        .pipe(Effect.flip)).code,
      "invalid_state",
    );
    yield* oauth.cancel(binding, review.flowId);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(approval);
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") assert.strictEqual(result.failure.code, "cancelled");
    assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
    assert.strictEqual((yield* oauth.status(binding)).status, "disconnected");
  }),
);

it.effect("keeps the review ID cancellable while registration is in flight", () =>
  Effect.gen(function* () {
    const registering = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const h = harness({
      metadata: { ...asMetadata, authorization_response_iss_parameter_supported: false },
      respond: ({ url }) =>
        url.endsWith("/register")
          ? Deferred.succeed(registering, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(jsonResponse({ client_id: "late-client" })),
            )
          : undefined,
    });
    const oauth = yield* Effect.service(OAuth.OutboundMcpOAuth).pipe(Effect.provide(h.layer));
    const review = yield* beginReview(oauth);
    const approval = yield* oauth
      .begin({ binding, redirectUri, approvedReviewId: review.flowId })
      .pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(registering);
    assert.strictEqual((yield* oauth.status(binding)).flowId, review.flowId);
    yield* oauth.cancel(binding, review.flowId);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(approval);
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") assert.strictEqual(result.failure.code, "cancelled");
    assert.strictEqual((yield* oauth.status(binding)).status, "disconnected");
    assert.strictEqual(h.data.size, 0);
  }),
);

it.effect("does not inherit authorization URL scopes that were absent from the review", () => {
  const h = harness({
    resource: { resource: binding.url, authorization_servers: [issuer], scopes_supported: [] },
    metadata: {
      ...asMetadata,
      authorization_endpoint: `${issuer}/authorize?scope=admin&scope=write&audience=tools`,
      authorization_response_iss_parameter_supported: false,
    },
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const review = yield* beginReview(oauth);
    assert.deepStrictEqual(review.profile.requestedScopes, []);
    const flow = yield* beginAuthorization(oauth, {
      binding,
      redirectUri,
      approvedReviewId: review.flowId,
    });
    const authorization = new URL(flow.authorizationUrl);
    assert.isFalse(authorization.searchParams.has("scope"));
    assert.strictEqual(authorization.searchParams.get("audience"), "tools");
  }).pipe(Effect.provide(h.layer));
});

it.effect.each([
  ["authorization_endpoint", "https://127.0.0.1/authorize"],
  ["token_endpoint", "https://169.254.169.254/token"],
  ["registration_endpoint", "http://registration.example.test/register"],
] as const)("rejects unsafe discovered %s before exposing a review", ([field, endpoint]) => {
  const h = harness({
    metadata: {
      ...asMetadata,
      [field]: endpoint,
      authorization_response_iss_parameter_supported: false,
    },
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    assert.strictEqual(
      (yield* oauth.begin({ binding, redirectUri }).pipe(Effect.flip)).code,
      "unsafe_url",
    );
    assert.isFalse(h.calls.some(({ init }) => init.method === "POST"));
    assert.strictEqual((yield* oauth.status(binding)).status, "disconnected");
  }).pipe(Effect.provide(h.layer));
});

it.effect("requires issuer on a reviewed flow when rediscovery advertises issuer support", () => {
  let supportsIssuer = false;
  const h = harness({
    respond: ({ url }) =>
      url.includes("/.well-known/oauth-authorization-server")
        ? Effect.succeed(
            jsonResponse({
              ...asMetadata,
              authorization_response_iss_parameter_supported: supportsIssuer,
            }),
          )
        : undefined,
  });
  return Effect.gen(function* () {
    const oauth = yield* OAuth.OutboundMcpOAuth;
    const first = yield* beginReview(oauth);
    supportsIssuer = true;
    const second = yield* beginReview(oauth, {
      binding,
      redirectUri,
      approvedReviewId: first.flowId,
    });
    const flow = yield* beginAuthorization(oauth, {
      binding,
      redirectUri,
      approvedReviewId: second.flowId,
    });
    assert.strictEqual(
      (yield* oauth.complete({ state: flow.state, code: "code" }).pipe(Effect.flip)).code,
      "invalid_response",
    );
    assert.isFalse(h.calls.some(({ url }) => url.endsWith("/token")));
  }).pipe(Effect.provide(h.layer));
});

import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { McpHttpTransport } from "./agentTools.ts";
import { AuthProvidersManageScope, AuthSettingsWriteScope } from "./auth.ts";
import { clientRpcRequiredScopes } from "./clientRpcPermissions.ts";
import {
  McpOAuthBeginInput,
  McpOAuthBeginResult,
  McpOAuthStatus,
  McpOAuthTarget,
} from "./mcpOAuth.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

const decodeTransport = Schema.decodeUnknownSync(McpHttpTransport);
const decodeStatus = Schema.decodeUnknownSync(McpOAuthStatus);
const decodeTarget = Schema.decodeUnknownSync(McpOAuthTarget);
const decodeBegin = Schema.decodeUnknownSync(McpOAuthBeginResult);
const decodeBeginInput = Schema.decodeUnknownSync(McpOAuthBeginInput);

describe("shared outbound MCP OAuth", () => {
  it("leaves existing HTTP transports in static-header mode", () => {
    const transport = { type: "http", url: "https://example.com/mcp", headers: [] };
    expect(decodeTransport(transport)).toEqual(transport);
    expect(decodeTransport({ ...transport, authentication: "oauth" })).toEqual({
      ...transport,
      authentication: "oauth",
    });
  });

  it("does not serialize credentials into status", () => {
    expect(
      decodeStatus({
        status: "connected",
        accessToken: "secret",
        refreshToken: "secret",
        clientSecret: "secret",
      }),
    ).toEqual({ status: "connected" });
    expect(decodeTarget({ name: "tools" })).toEqual({ name: "tools" });
  });

  it("requires a complete trust profile and exposes no sign-in link during review", () => {
    const profile = {
      resource: "https://tools.example/mcp",
      issuer: "https://login.example",
      authorizationEndpoint: "https://login.example/authorize",
      tokenEndpoint: "https://login.example/token",
      registrationEndpoint: "https://login.example/register",
      requestedScopes: ["tools:read"],
    };
    const review = { _tag: "trust-required", flowId: "review-a", expiresAt: 123, profile };
    expect(decodeBegin({ ...review, authorizationUrl: "https://login.example/authorize" })).toEqual(
      review,
    );
    expect(() => decodeBegin({ ...review, profile: undefined })).toThrow();
    expect(() => decodeStatus({ status: "trust-required", flowId: "review-a" })).toThrow();
    expect(decodeStatus({ ...review, status: "trust-required" })).toEqual({
      status: "trust-required",
      flowId: "review-a",
      expiresAt: 123,
      profile,
    });
  });

  it("accepts only a server-issued review ID rather than client-supplied trust details", () => {
    const input = { name: "tools", approvedReviewId: "review-a" };
    expect(
      decodeBeginInput({
        ...input,
        issuer: "https://untrusted.example",
        trustIssuer: true,
      }),
    ).toEqual(input);
    expect(() => decodeBeginInput({ ...input, approvedReviewId: "" })).toThrow();
  });

  it("registers each lifecycle operation with destination permissions", () => {
    for (const method of [
      WS_METHODS.mcpOAuthBegin,
      WS_METHODS.mcpOAuthCancel,
      WS_METHODS.mcpOAuthDisconnect,
    ]) {
      expect(WsRpcGroup.requests.has(method)).toBe(true);
      expect(clientRpcRequiredScopes(method, undefined)).toEqual([
        AuthProvidersManageScope,
        AuthSettingsWriteScope,
      ]);
    }
    expect(WsRpcGroup.requests.has(WS_METHODS.mcpOAuthStatus)).toBe(true);
    expect(clientRpcRequiredScopes(WS_METHODS.mcpOAuthStatus, undefined)).toEqual([
      AuthProvidersManageScope,
    ]);
  });
});

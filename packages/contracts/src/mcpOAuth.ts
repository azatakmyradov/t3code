import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { McpServerName } from "./agentTools.ts";

/** Credentials belong to a saved transport, not a provider or an inherited project switch. */
export const McpOAuthTarget = Schema.Struct({
  name: McpServerName,
  projectId: Schema.optionalKey(ProjectId),
});
export type McpOAuthTarget = typeof McpOAuthTarget.Type;

const FlowId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

/** Approval is bound to a server-issued review, never to client-supplied endpoint details. */
export const McpOAuthBeginInput = Schema.Struct({
  ...McpOAuthTarget.fields,
  approvedReviewId: Schema.optionalKey(FlowId),
});
export type McpOAuthBeginInput = typeof McpOAuthBeginInput.Type;

const ReviewUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(16_384));
export const McpOAuthTrustProfile = Schema.Struct({
  resource: ReviewUrl,
  issuer: ReviewUrl,
  authorizationEndpoint: ReviewUrl,
  tokenEndpoint: ReviewUrl,
  registrationEndpoint: ReviewUrl,
  requestedScopes: Schema.Array(TrimmedNonEmptyString),
});
export type McpOAuthTrustProfile = typeof McpOAuthTrustProfile.Type;

export const McpOAuthTrustReview = Schema.Struct({
  _tag: Schema.Literal("trust-required"),
  flowId: FlowId,
  expiresAt: Schema.Number,
  profile: McpOAuthTrustProfile,
});
export type McpOAuthTrustReview = typeof McpOAuthTrustReview.Type;

export const McpOAuthBeginResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("authorization"),
    flowId: FlowId,
    authorizationUrl: ReviewUrl,
    expiresAt: Schema.Number,
  }),
  McpOAuthTrustReview,
]);
export type McpOAuthBeginResult = typeof McpOAuthBeginResult.Type;

/** Safe status only. Access tokens, refresh tokens and client secrets never cross this RPC. */
export const McpOAuthStatus = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["disconnected", "connecting", "connected", "expired"]),
    flowId: Schema.optionalKey(FlowId),
    expiresAt: Schema.optionalKey(Schema.Number),
    message: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("trust-required"),
    flowId: FlowId,
    expiresAt: Schema.Number,
    profile: McpOAuthTrustProfile,
    message: Schema.optionalKey(Schema.String),
  }),
]);
export type McpOAuthStatus = typeof McpOAuthStatus.Type;

export const McpOAuthCancelInput = Schema.Struct({
  ...McpOAuthTarget.fields,
  flowId: FlowId,
});
export type McpOAuthCancelInput = typeof McpOAuthCancelInput.Type;

/** Only fixed, safe descriptions: never embed an upstream response or authorization URL. */
export class McpOAuthError extends Schema.TaggedError<McpOAuthError>()("McpOAuthError", {
  code: Schema.Literals([
    "invalid_configuration",
    "unsupported",
    "authorization_failed",
    "not_found",
    "expired",
    "unavailable",
  ]),
  message: Schema.String,
}) {}

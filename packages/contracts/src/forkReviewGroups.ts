import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError, TextGenerationError } from "./git.ts";
import { VcsError } from "./vcs.ts";

/**
 * Fork-local contracts for the AI "semantic group diff" review aid.
 *
 * The server runs the working-tree diff through the configured text-generation
 * model and returns the changed files clustered into semantically-related
 * groups, each carrying a plain-language description, a "what changed" and a
 * "what to review" note, plus a risk score. The web diff viewer renders the
 * groups risk-first so the most critical changes surface at the top.
 *
 * Kept in a fork-prefixed file and aggregated through `forkRpc.ts` so upstream
 * `rpc.ts` only gains the aggregate fork import and spreads.
 */

export const ReviewSemanticGroupRiskLevel = Schema.Literals(["critical", "high", "medium", "low"]);
export type ReviewSemanticGroupRiskLevel = typeof ReviewSemanticGroupRiskLevel.Type;

/** Normalized 0-100 risk score; the server clamps/rounds the model's value. */
export const ReviewSemanticGroupRisk = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(100),
);
export type ReviewSemanticGroupRisk = typeof ReviewSemanticGroupRisk.Type;

export const ReviewSemanticGroup = Schema.Struct({
  /** Stable, server-assigned id (groups are returned risk-sorted). */
  id: TrimmedNonEmptyString,
  /** Short human label for the cluster, e.g. "Auth token refresh". */
  title: TrimmedNonEmptyString,
  /** What this set of changes does / its purpose. */
  description: Schema.String,
  /** Concrete summary of what actually changed in these files. */
  whatChanged: Schema.String,
  /** What a reviewer should pay closest attention to here. */
  reviewFocus: Schema.String,
  /** 0-100 risk score; higher means review more carefully. */
  risk: ReviewSemanticGroupRisk,
  /** Bucketed risk level derived from {@link risk} for colour-coding. */
  riskLevel: ReviewSemanticGroupRiskLevel,
  /** Why this group carries the risk it does. */
  riskReason: Schema.String,
  /** Repo-relative paths of the changed files in this group. */
  files: Schema.Array(TrimmedNonEmptyString),
});
export type ReviewSemanticGroup = typeof ReviewSemanticGroup.Type;

export const ReviewSemanticGroupsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  /** Which diff source to group; defaults to the working tree. */
  sourceId: Schema.optional(TrimmedNonEmptyString),
});
export type ReviewSemanticGroupsInput = typeof ReviewSemanticGroupsInput.Type;

export const ReviewSemanticGroupsResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  /** The model id used for grouping, or null when no diff was available. */
  model: Schema.NullOr(TrimmedNonEmptyString),
  /** True when the diff fed to the model was size-capped. */
  truncated: Schema.Boolean,
  /** Groups ordered most-critical first. */
  groups: Schema.Array(ReviewSemanticGroup),
});
export type ReviewSemanticGroupsResult = typeof ReviewSemanticGroupsResult.Type;

export const ReviewSemanticGroupsError = Schema.Union([
  VcsError,
  GitCommandError,
  TextGenerationError,
]);
export type ReviewSemanticGroupsError = typeof ReviewSemanticGroupsError.Type;

// ── Fork RPC seam ─────────────────────────────────────────────────────────
//
// Method name + RPC definition live here; `forkRpc.ts` aggregates them with
// other fork RPCs before upstream `rpc.ts` imports them.

export const FORK_REVIEW_GROUPS_WS_METHODS = {
  reviewGroupSemanticDiff: "review.groupSemanticDiff",
} as const;

export const WsReviewGroupSemanticDiffRpc = Rpc.make(
  FORK_REVIEW_GROUPS_WS_METHODS.reviewGroupSemanticDiff,
  {
    payload: ReviewSemanticGroupsInput,
    success: ReviewSemanticGroupsResult,
    error: Schema.Union([
      VcsError,
      GitCommandError,
      TextGenerationError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const FORK_REVIEW_GROUPS_RPCS = [WsReviewGroupSemanticDiffRpc] as const;

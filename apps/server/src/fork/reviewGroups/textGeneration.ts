import type { ModelSelection, ReviewDiffPreviewSourceKind } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

/**
 * Driver kinds whose current invocation modes permit the agent to run git /
 * read files (Claude `--dangerously-skip-permissions`, Codex `-s read-only`).
 * Semantic diff grouping is agentic: the agent reproduces and reads the
 * reviewed diff itself, so only these providers support it.
 */
export const SEMANTIC_DIFF_GROUPS_SUPPORTED_DRIVERS = ["claudeAgent", "codex"] as const;

export type SemanticDiffGroupsSupportedDriver =
  (typeof SEMANTIC_DIFF_GROUPS_SUPPORTED_DRIVERS)[number];

/** Shared error detail surfaced both server-side and from provider capability checks. */
export const SEMANTIC_DIFF_GROUPS_UNSUPPORTED_DETAIL =
  "Semantic diff grouping is only supported for Claude and Codex.";

export interface SemanticDiffGroupsGenerationInput {
  cwd: string;
  /**
   * Scope of the diff the viewer is showing. The agent reproduces this exact
   * diff with its own tools instead of receiving the patch text inline.
   */
  kind: ReviewDiffPreviewSourceKind;
  /** Base ref to diff against (e.g. "HEAD" for the working tree). */
  baseRef: string;
  /** Head ref for branch-range diffs; null for the working tree. */
  headRef: string | null;
  /** What model and provider instance to use for generation. */
  modelSelection: ModelSelection;
}

/**
 * One model-produced cluster of related changes. The server post-processes this
 * (assigns ids, derives a risk level, sorts) before returning it over RPC.
 */
export interface SemanticDiffGroup {
  title: string;
  description: string;
  whatChanged: string;
  reviewFocus: string;
  /** Raw 0-100 risk score as scored by the model. */
  risk: number;
  riskReason: string;
  files: ReadonlyArray<string>;
}

export interface SemanticDiffGroupsGenerationResult {
  groups: ReadonlyArray<SemanticDiffGroup>;
}

export interface SemanticDiffGroupsCapability {
  readonly generateSemanticDiffGroups: (
    input: SemanticDiffGroupsGenerationInput,
  ) => Effect.Effect<SemanticDiffGroupsGenerationResult, TextGenerationError>;
}

export function isSemanticDiffGroupsSupportedDriver(
  driver: string,
): driver is SemanticDiffGroupsSupportedDriver {
  return SEMANTIC_DIFF_GROUPS_SUPPORTED_DRIVERS.includes(
    driver as SemanticDiffGroupsSupportedDriver,
  );
}

export function hasSemanticDiffGroupsCapability(
  value: unknown,
): value is SemanticDiffGroupsCapability {
  return (
    typeof value === "object" &&
    value !== null &&
    "generateSemanticDiffGroups" in value &&
    typeof value.generateSemanticDiffGroups === "function"
  );
}

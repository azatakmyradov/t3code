/**
 * Fork seam for the AI semantic-diff-groups WS RPC handler.
 *
 * Keeps the authorization-scope entry and handler implementation out of
 * upstream `ws.ts`. `fork/rpcHandlers.ts` aggregates this table and handler
 * builder with the other fork RPCs before upstream registration.
 *
 * The handler re-uses the existing `review.getDiffPreview` to obtain the diff,
 * resolves the operator-configured text-generation model from settings, runs the
 * diff through a provider-local semantic-groups capability, and normalizes the
 * result risk-first.
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  AuthOrchestrationReadScope,
  TextGenerationError,
  WS_METHODS,
  type AuthEnvironmentScope,
  type EnvironmentAuthorizationError,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewSource,
  type ReviewSemanticGroupsInput,
  type ReviewSemanticGroupsResult,
} from "@t3tools/contracts";

import type * as ReviewService from "../../review/ReviewService.ts";
import type * as ServerSettings from "../../serverSettings.ts";
import {
  SEMANTIC_DIFF_GROUPS_UNSUPPORTED_DETAIL,
  hasSemanticDiffGroupsCapability,
  isSemanticDiffGroupsSupportedDriver,
} from "./textGeneration.ts";
import type * as ProviderInstanceRegistry from "../../provider/Services/ProviderInstanceRegistry.ts";
import { normalizeSemanticGroups } from "./reviewGroups.ts";

/**
 * `[method, requiredScope]` pair, intended to be spread into the upstream
 * `RPC_REQUIRED_SCOPE` map. Reading a diff is a read-scoped operation.
 */
export const FORK_REVIEW_GROUPS_REQUIRED_SCOPE: ReadonlyArray<
  readonly [string, AuthEnvironmentScope]
> = [[WS_METHODS.reviewGroupSemanticDiff, AuthOrchestrationReadScope]];

/** Mirrors the locally-bound `observeRpcEffect` helper in `ws.ts`. */
export type ObserveRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;

const REVIEW_GROUPS_TRACE_ATTRIBUTES = { "rpc.aggregate": "review" } as const;

export interface ForkReviewGroupsDeps {
  readonly review: Pick<ReviewService.ReviewService["Service"], "getDiffPreview">;
  readonly providerInstances: Pick<
    ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
    "getInstance"
  >;
  readonly serverSettings: Pick<ServerSettings.ServerSettingsService["Service"], "getSettings">;
}

/** Pick the diff source to group: explicit id, else working tree, else first. */
function selectSource(
  sources: ReadonlyArray<ReviewDiffPreviewSource>,
  sourceId: string | undefined,
): ReviewDiffPreviewSource | null {
  if (sources.length === 0) return null;
  if (sourceId) {
    const match = sources.find((source) => source.id === sourceId);
    if (match) return match;
  }
  return sources.find((source) => source.kind === "working-tree") ?? sources[0] ?? null;
}

const groupSemanticDiff =
  (
    deps: ForkReviewGroupsDeps,
  ): ((
    input: ReviewSemanticGroupsInput,
  ) => Effect.Effect<
    ReviewSemanticGroupsResult,
    ReviewDiffPreviewError | TextGenerationError,
    never
  >) =>
  (input) =>
    Effect.gen(function* () {
      const preview = yield* deps.review.getDiffPreview({
        cwd: input.cwd,
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
      });
      const source = selectSource(preview.sources, input.sourceId);
      const generatedAt = yield* DateTime.now;

      if (!source || source.diff.trim().length === 0) {
        return {
          cwd: input.cwd,
          generatedAt,
          model: null,
          truncated: false,
          groups: [],
        };
      }

      const settings = yield* deps.serverSettings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateSemanticDiffGroups",
              detail: "Failed to load text generation settings.",
              cause,
            }),
        ),
      );
      // Prefer the dedicated semantic-groups model when configured; otherwise fall
      // back to the global text-generation model.
      const modelSelection =
        settings.fork.reviewGroupsModelSelection ?? settings.textGenerationModelSelection;

      const providerInstance = yield* deps.providerInstances.getInstance(modelSelection.instanceId);
      if (!providerInstance) {
        return yield* new TextGenerationError({
          operation: "generateSemanticDiffGroups",
          detail: `No provider instance registered for id '${modelSelection.instanceId}'.`,
        });
      }

      if (!isSemanticDiffGroupsSupportedDriver(providerInstance.driverKind)) {
        return yield* new TextGenerationError({
          operation: "generateSemanticDiffGroups",
          detail: SEMANTIC_DIFF_GROUPS_UNSUPPORTED_DETAIL,
        });
      }

      const semanticGroups = providerInstance.textGeneration;
      if (!hasSemanticDiffGroupsCapability(semanticGroups)) {
        return yield* new TextGenerationError({
          operation: "generateSemanticDiffGroups",
          detail: `Provider instance '${modelSelection.instanceId}' does not expose semantic diff grouping.`,
        });
      }

      const raw = yield* semanticGroups.generateSemanticDiffGroups({
        cwd: input.cwd,
        kind: source.kind,
        baseRef: source.baseRef ?? "HEAD",
        headRef: source.headRef,
        modelSelection,
      });

      return {
        cwd: input.cwd,
        generatedAt,
        model: modelSelection.model.trim().length > 0 ? modelSelection.model : null,
        truncated: source.truncated,
        groups: normalizeSemanticGroups(raw.groups),
      };
    });

/**
 * Build the review-groups RPC handler object, keyed by
 * `WS_METHODS.reviewGroupSemanticDiff`, to be spread into the upstream handler
 * map passed to `WsRpcGroup.of`.
 */
export const makeForkReviewGroupsHandlers = (
  deps: ForkReviewGroupsDeps,
  observeRpcEffect: ObserveRpcEffect,
) => ({
  [WS_METHODS.reviewGroupSemanticDiff]: (input: ReviewSemanticGroupsInput) =>
    observeRpcEffect(
      WS_METHODS.reviewGroupSemanticDiff,
      groupSemanticDiff(deps)(input),
      REVIEW_GROUPS_TRACE_ATTRIBUTES,
    ),
});

import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ReviewSemanticGroupsInput } from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

export function buildReviewGroupsSingleFlightKey(input: {
  readonly environmentId: EnvironmentId;
  readonly input: Pick<ReviewSemanticGroupsInput, "cwd" | "baseRef" | "sourceId">;
}): string {
  return JSON.stringify([
    input.environmentId,
    input.input.cwd,
    input.input.sourceId ?? null,
    input.input.baseRef ?? null,
  ]);
}

/**
 * Fork-local client command for the AI semantic-diff-groups RPC. Defined here
 * (rather than in the base `reviewEnvironment`) so the feature stays fork-local
 * — mirrors how `jiraEnvironment` builds its own commands.
 *
 * It is a one-shot command (not a cached query): grouping is an expensive model
 * call the user triggers explicitly with a button. `singleFlight` dedupes
 * double-clicks for the same diff source.
 */
export const reviewGroupsEnvironment = {
  groupSemanticDiff: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:review:semantic-groups",
    tag: WS_METHODS.reviewGroupSemanticDiff,
    concurrency: {
      mode: "singleFlight",
      key: buildReviewGroupsSingleFlightKey,
    },
  }),
};

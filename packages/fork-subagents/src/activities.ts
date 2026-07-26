import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  EMPTY_SUBAGENT_COUNTS,
  SubagentRelation,
  SubagentRunResult,
  SubagentSummary,
  type SubagentCounts,
} from "./contracts.ts";

export const SUBAGENT_METADATA_ACTIVITY = "fork.subagent.metadata";
export const SUBAGENT_SUMMARY_UPDATED_ACTIVITY = "fork.subagent.summary.updated";
export const SUBAGENT_RUN_SETTLED_ACTIVITY = "fork.subagent.run.settled";
export const SUBAGENT_RUN_STATE_ACTIVITY = "fork.subagent.run.state";

export const SubagentMetadataActivityPayload = Schema.Struct({
  relation: SubagentRelation,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export const SubagentSummaryUpdatedActivityPayload = Schema.Struct({
  summary: SubagentSummary,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export const SubagentRunActivityPayload = Schema.Struct({
  result: SubagentRunResult,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

const decodeMetadata = Schema.decodeUnknownOption(SubagentMetadataActivityPayload);
const decodeSummary = Schema.decodeUnknownOption(SubagentSummaryUpdatedActivityPayload);
const decodeRun = Schema.decodeUnknownOption(SubagentRunActivityPayload);

export const decodeSubagentMetadataActivity = (payload: unknown) =>
  Option.getOrUndefined(decodeMetadata(payload));

export const decodeSubagentSummaryUpdatedActivity = (payload: unknown) =>
  Option.getOrUndefined(decodeSummary(payload));

export const decodeSubagentRunActivity = (payload: unknown) =>
  Option.getOrUndefined(decodeRun(payload));

export function foldSubagentSummaries(
  activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "kind" | "payload">>,
  initial: ReadonlyArray<SubagentSummary> = [],
): ReadonlyArray<SubagentSummary> {
  const summaries = new Map(initial.map((summary) => [summary.displayId, summary] as const));
  for (const activity of activities) {
    if (activity.kind !== SUBAGENT_SUMMARY_UPDATED_ACTIVITY) continue;
    const payload = decodeSubagentSummaryUpdatedActivity(activity.payload);
    if (payload) summaries.set(payload.summary.displayId, payload.summary);
  }
  // Hermes does not ship the ES2023 change-by-copy array methods.
  return [...summaries.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.displayId.localeCompare(left.displayId),
  );
}

export function foldSubagentCounts(
  activitiesOrSummaries:
    | ReadonlyArray<Pick<OrchestrationThreadActivity, "kind" | "payload">>
    | ReadonlyArray<SubagentSummary>,
): SubagentCounts {
  const summaries =
    activitiesOrSummaries.length > 0 && "kind" in activitiesOrSummaries[0]!
      ? foldSubagentSummaries(
          activitiesOrSummaries as ReadonlyArray<
            Pick<OrchestrationThreadActivity, "kind" | "payload">
          >,
        )
      : (activitiesOrSummaries as ReadonlyArray<SubagentSummary>);
  return summaries.reduce<SubagentCounts>(
    (counts, summary) => ({
      running: counts.running + (summary.status === "running" ? 1 : 0),
      done: counts.done + (summary.status === "done" ? 1 : 0),
      failed: counts.failed + (summary.status === "error" ? 1 : 0),
      needsAttention:
        counts.needsAttention + (summary.hasPendingApproval || summary.hasPendingUserInput ? 1 : 0),
    }),
    EMPTY_SUBAGENT_COUNTS,
  );
}

export function hasBlockingSubagents(
  activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "kind" | "payload">>,
): boolean {
  const counts = foldSubagentCounts(activities);
  return counts.running > 0 || counts.needsAttention > 0;
}

export function isSubagentBookkeepingActivity(
  activity: Pick<OrchestrationThreadActivity, "kind">,
): boolean {
  return (
    activity.kind === SUBAGENT_METADATA_ACTIVITY ||
    activity.kind === SUBAGENT_SUMMARY_UPDATED_ACTIVITY ||
    activity.kind === SUBAGENT_RUN_SETTLED_ACTIVITY ||
    activity.kind === SUBAGENT_RUN_STATE_ACTIVITY
  );
}

import type {
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";

import { isSubagentBookkeepingActivity } from "./activities.ts";
import type { SubagentSummary } from "./contracts.ts";

export function subagentElapsedMs(summary: SubagentSummary, now: number): number {
  return Math.max(
    0,
    (summary.settledAt ? Date.parse(summary.settledAt) : now) - Date.parse(summary.createdAt),
  );
}

export function subagentContextPercent(summary: SubagentSummary): number | null {
  const usage = summary.contextUsage;
  if (!usage || usage.maxTokens <= 0) return null;
  return Math.min(100, Math.round((usage.usedTokens / usage.maxTokens) * 100));
}

export interface NormalizedSubagentTranscript {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export function normalizeSubagentTranscript(
  thread: Pick<OrchestrationThread, "messages" | "activities">,
): NormalizedSubagentTranscript {
  return {
    messages: thread.messages,
    activities: thread.activities.filter((activity) => !isSubagentBookkeepingActivity(activity)),
  };
}

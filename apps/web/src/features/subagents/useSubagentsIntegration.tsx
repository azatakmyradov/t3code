import type { OrchestrationThread } from "@t3tools/contracts";
import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import { Bot } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { subagentStatusColor } from "./subagentStatusColor";

export interface SubagentsIntegration {
  readonly summaries: ReadonlyArray<SubagentSummary>;
  readonly available: boolean;
  readonly running: boolean;
  readonly needsAttention: boolean;
  readonly statusColor: string;
  readonly renderHeaderItem: (onOpen: () => void) => ReactNode;
}

export function useSubagentsIntegration(
  thread: Pick<OrchestrationThread, "activities"> | null,
): SubagentsIntegration {
  const summaries = thread ? foldSubagentSummaries(thread.activities) : [];
  const available = summaries.length > 0;
  const running = summaries.some((summary) => summary.status === "running");
  const needsAttention = summaries.some(
    (summary) => summary.hasPendingApproval || summary.hasPendingUserInput,
  );
  const hasError = summaries.some((summary) => summary.status === "error");
  const statusColor = needsAttention
    ? "bg-amber-500"
    : subagentStatusColor(hasError ? "error" : running ? "running" : "done");

  return {
    summaries,
    available,
    running,
    needsAttention,
    statusColor,
    renderHeaderItem: (onOpen) =>
      available ? (
        <button
          type="button"
          onClick={onOpen}
          className="relative rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Open agents panel, ${summaries.length} agent${summaries.length === 1 ? "" : "s"}`}
        >
          <Bot className="size-4" />
          <span className={cn("absolute right-0 top-0 size-2 rounded-full", statusColor)} />
        </button>
      ) : null,
  };
}

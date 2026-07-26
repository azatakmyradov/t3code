import {
  hasNativeSubagentActivity,
  isNativeSubagentActivity,
} from "@t3tools/client-runtime/state/native-subagents";
import type {
  EnvironmentId,
  NativeHarnessSubagentSummary,
  OrchestrationThread,
} from "@t3tools/contracts";
import { foldSubagentCounts, foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import { useEffect, useMemo, type ReactNode } from "react";

import { nativeSubagentEnvironment } from "../../state/nativeSubagents";
import { useEnvironmentQuery } from "../../state/query";

export interface SubagentsIntegration {
  readonly summaries: ReadonlyArray<SubagentSummary>;
  readonly nativeSummaries: ReadonlyArray<NativeHarnessSubagentSummary>;
  readonly nativeError: string | null;
  readonly nativePending: boolean;
  readonly refreshNative: () => void;
  readonly available: boolean;
  readonly renderChatItem: (onOpen: () => void) => ReactNode;
}

export function useSubagentsIntegration(
  environmentId: EnvironmentId,
  thread: Pick<OrchestrationThread, "id" | "activities"> | null,
): SubagentsIntegration {
  const summaries = thread ? foldSubagentSummaries(thread.activities) : [];
  const nativeObserved = thread ? hasNativeSubagentActivity(thread.activities) : false;
  const nativeQuery = useEnvironmentQuery(
    nativeObserved && thread
      ? nativeSubagentEnvironment.list({
          environmentId,
          input: { threadId: thread.id },
        })
      : null,
  );
  const nativeSummaries = useMemo(
    () => nativeQuery.data?.subagents ?? [],
    [nativeQuery.data?.subagents],
  );
  const nativeActivityCount = thread?.activities.filter(isNativeSubagentActivity).length ?? 0;
  useEffect(() => {
    if (nativeObserved) nativeQuery.refresh();
  }, [nativeActivityCount, nativeObserved, nativeQuery.refresh]);
  const available =
    summaries.length > 0 || nativeObserved || nativeQuery.isPending || nativeSummaries.length > 0;

  return {
    summaries,
    nativeSummaries,
    nativeError: nativeQuery.error,
    nativePending: nativeQuery.isPending,
    refreshNative: nativeQuery.refresh,
    available,
    renderChatItem: (onOpen) =>
      available ? (
        <SubagentsChatItem
          summaries={summaries}
          nativeSummaries={nativeSummaries}
          nativePending={nativeQuery.isPending}
          onOpen={onOpen}
        />
      ) : null,
  };
}

export function SubagentsChatItem(props: {
  readonly summaries: ReadonlyArray<SubagentSummary>;
  readonly nativeSummaries?: ReadonlyArray<NativeHarnessSubagentSummary>;
  readonly nativePending?: boolean;
  readonly onOpen: () => void;
}) {
  const counts = foldSubagentCounts(props.summaries);
  const nativeRunning =
    props.nativeSummaries?.filter((summary) => summary.status === "running").length ?? 0;
  const nativeDone =
    props.nativeSummaries?.filter((summary) => summary.status !== "running").length ?? 0;
  const nativeFailed =
    props.nativeSummaries?.filter((summary) => summary.status === "error").length ?? 0;
  const nativeSettled = nativeDone - nativeFailed;
  const statuses = [
    counts.running + nativeRunning > 0
      ? {
          count: counts.running + nativeRunning,
          label: "running",
          symbol: "●",
          className: "text-orange-500",
        }
      : null,
    counts.done + nativeSettled > 0
      ? {
          count: counts.done + nativeSettled,
          label: "done",
          symbol: "✓",
          className: "text-emerald-500",
        }
      : null,
    counts.failed + nativeFailed > 0
      ? {
          count: counts.failed + nativeFailed,
          label: "failed",
          symbol: "×",
          className: "text-red-500",
        }
      : null,
  ].filter((status) => status !== null);
  if (statuses.length === 0 && props.nativePending) {
    statuses.push({
      count: 0,
      label: "loading",
      symbol: "…",
      className: "text-muted-foreground",
    });
  }

  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground tabular-nums transition-colors hover:bg-accent/30 hover:text-foreground"
      aria-label={`Open agents panel, ${statuses.map((status) => `${status.count} ${status.label}`).join(", ")}`}
    >
      <span>subagents:</span>
      {statuses.map((status, index) => (
        <span key={status.label} className="contents">
          {index > 0 ? <span className="text-muted-foreground/50">·</span> : null}
          <span className={status.className}>
            <span aria-hidden>{status.symbol}</span> {status.count} {status.label}
          </span>
        </span>
      ))}
    </button>
  );
}

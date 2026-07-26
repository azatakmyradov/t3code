import {
  hasNativeSubagentActivity,
  isNativeSubagentActivity,
} from "@t3tools/client-runtime/state/native-subagents";
import type { EnvironmentId, OrchestrationThread } from "@t3tools/contracts";
import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo } from "react";

import type { AndroidHeaderAction } from "../../components/AndroidScreenHeader";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { SubagentsInspector } from "./SubagentsInspector";
import { nativeSubagentEnvironment } from "../../state/nativeSubagents";
import { useEnvironmentQuery } from "../../state/query";

interface IntegrationInput {
  readonly environmentId: EnvironmentId | null;
  readonly thread: Pick<OrchestrationThread, "id" | "activities" | "updatedAt" | "session"> | null;
  readonly headerInset: number;
  readonly onOpen: () => void;
}

export function useSubagentsInspectorIntegration(input: IntegrationInput) {
  const summaries = useMemo(
    () => (input.thread ? foldSubagentSummaries(input.thread.activities) : []),
    [input.thread],
  );
  const nativeObserved = input.thread ? hasNativeSubagentActivity(input.thread.activities) : false;
  const nativeQuery = useEnvironmentQuery(
    input.environmentId && input.thread && nativeObserved
      ? nativeSubagentEnvironment.list({
          environmentId: input.environmentId,
          input: { threadId: input.thread.id },
        })
      : null,
  );
  const nativeSummaries = useMemo(
    () => nativeQuery.data?.subagents ?? [],
    [nativeQuery.data?.subagents],
  );
  const nativeActivityCount = input.thread?.activities.filter(isNativeSubagentActivity).length ?? 0;
  useEffect(() => {
    if (nativeObserved) nativeQuery.refresh();
  }, [nativeActivityCount, nativeObserved, nativeQuery.refresh]);
  const available =
    input.environmentId !== null &&
    (summaries.length > 0 || nativeObserved || nativeQuery.isPending || nativeSummaries.length > 0);
  const running =
    summaries.some((summary) => summary.status === "running") ||
    nativeSummaries.some((summary) => summary.status === "running");
  const needsAttention = summaries.some(
    (summary) => summary.hasPendingApproval || summary.hasPendingUserInput,
  );
  const headerItem = useMemo(
    () =>
      available
        ? withNativeGlassHeaderItem({
            accessibilityLabel: `Open agents${running ? ", running" : ""}`,
            icon: { name: "person.2", type: "sfSymbol" as const },
            identifier: "thread-agents",
            onPress: input.onOpen,
            type: "button" as const,
          })
        : null,
    [available, input.onOpen, running],
  );
  const menuAction = useMemo<AndroidHeaderAction | null>(
    () =>
      available
        ? {
            accessibilityLabel: "Open agents",
            icon: "person.2",
            onPress: input.onOpen,
          }
        : null,
    [available, input.onOpen],
  );
  const Inspector = useCallback<ComponentType>(
    () =>
      input.environmentId ? (
        <SubagentsInspector
          environmentId={input.environmentId}
          headerInset={input.headerInset}
          summaries={summaries}
          nativeSummaries={nativeSummaries}
          nativePending={nativeQuery.isPending}
          nativeError={nativeQuery.error}
          parentThreadId={input.thread?.id ?? null}
          parentUpdatedAt={input.thread?.updatedAt ?? null}
          parentSessionActive={
            input.thread?.session?.status === "starting" ||
            input.thread?.session?.status === "running"
          }
          refreshNativeList={nativeQuery.refresh}
        />
      ) : null,
    [
      input.environmentId,
      input.headerInset,
      input.thread,
      nativeQuery.error,
      nativeQuery.isPending,
      nativeQuery.refresh,
      nativeSummaries,
      summaries,
    ],
  );

  return {
    headerItem,
    compactAction: headerItem,
    menuAction,
    Inspector,
    available,
    running,
    needsAttention,
  } as const;
}

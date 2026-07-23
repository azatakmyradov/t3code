import type { EnvironmentId, OrchestrationThread } from "@t3tools/contracts";
import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import type { ComponentType } from "react";
import { useCallback, useMemo } from "react";

import type { AndroidHeaderAction } from "../../components/AndroidScreenHeader";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { SubagentsInspector } from "./SubagentsInspector";

interface IntegrationInput {
  readonly environmentId: EnvironmentId | null;
  readonly thread: Pick<OrchestrationThread, "activities"> | null;
  readonly headerInset: number;
  readonly onOpen: () => void;
}

export function useSubagentsInspectorIntegration(input: IntegrationInput) {
  const summaries = useMemo(
    () => (input.thread ? foldSubagentSummaries(input.thread.activities) : []),
    [input.thread],
  );
  const available = summaries.length > 0 && input.environmentId !== null;
  const running = summaries.some((summary) => summary.status === "running");
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
        />
      ) : null,
    [input.environmentId, input.headerInset, summaries],
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

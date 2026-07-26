import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import {
  NativeHarnessSubagentId,
  ProviderDriverKind,
  type NativeHarnessSubagentSummary,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SubagentsChatItem } from "./useSubagentsIntegration";

function summary(displayId: string, status: SubagentSummary["status"]): SubagentSummary {
  return {
    threadId: `thread-${displayId}`,
    displayId,
    title: `Agent ${displayId}`,
    providerInstanceId: "provider-1",
    provider: "codex",
    model: "gpt-5",
    cwd: "/workspace",
    status,
    outcome: status === "running" ? null : status === "done" ? "completed" : "failed",
    createdAt: "2026-07-23T12:00:00.000Z",
    settledAt: status === "running" ? null : "2026-07-23T12:01:00.000Z",
    turnCount: 1,
    contextUsage: null,
    hasPendingApproval: false,
    hasPendingUserInput: false,
    error: status === "error" ? "Failed" : null,
  } as SubagentSummary;
}

describe("SubagentsChatItem", () => {
  it("shows running, done, and failed subagent counts", () => {
    const markup = renderToStaticMarkup(
      <SubagentsChatItem
        summaries={[
          summary("sa-1", "running"),
          summary("sa-2", "done"),
          summary("sa-3", "done"),
          summary("sa-4", "error"),
        ]}
        onOpen={() => {}}
      />,
    );

    expect(markup).toContain("subagents:");
    expect(markup).toContain("1 running");
    expect(markup).toContain("2 done");
    expect(markup).toContain("1 failed");
    expect(markup).toContain('aria-label="Open agents panel, 1 running, 2 done, 1 failed"');
  });

  it("includes native-only agents in the affordance counts", () => {
    const native: NativeHarnessSubagentSummary = {
      id: NativeHarnessSubagentId.make("native-1"),
      provider: ProviderDriverKind.make("codex"),
      title: "Native child",
      status: "running",
      createdAt: null,
      updatedAt: null,
      readOnly: true,
    };
    const markup = renderToStaticMarkup(
      <SubagentsChatItem summaries={[]} nativeSummaries={[native]} onOpen={() => {}} />,
    );

    expect(markup).toContain("1 running");
    expect(markup).toContain('aria-label="Open agents panel, 1 running"');
  });
});

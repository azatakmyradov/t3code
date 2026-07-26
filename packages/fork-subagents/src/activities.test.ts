import { SubagentId, SubagentSummary, type SubagentSummary as Summary } from "./contracts.ts";
import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  SUBAGENT_METADATA_ACTIVITY,
  SUBAGENT_SUMMARY_UPDATED_ACTIVITY,
  decodeSubagentSummaryUpdatedActivity,
  foldSubagentCounts,
  foldSubagentSummaries,
  hasBlockingSubagents,
  isSubagentBookkeepingActivity,
} from "./activities.ts";
import { describe, expect, it } from "vite-plus/test";

const summary = (input: Partial<Summary> = {}): Summary =>
  SubagentSummary.make({
    threadId: ThreadId.make("t3-internal-subagent-child-1"),
    displayId: SubagentId.make("sa-1"),
    title: "Worker",
    providerInstanceId: ProviderInstanceId.make("codex"),
    provider: ProviderDriverKind.make("codex"),
    model: "gpt-5",
    cwd: "/tmp/project",
    status: "running",
    outcome: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    settledAt: null,
    turnCount: 0,
    contextUsage: null,
    hasPendingApproval: false,
    hasPendingUserInput: false,
    error: null,
    ...input,
  });

describe("subagent activities", () => {
  it("rejects malformed and oversized summary payloads", () => {
    expect(
      decodeSubagentSummaryUpdatedActivity({ summary: { displayId: "nope" } }),
    ).toBeUndefined();
    expect(
      decodeSubagentSummaryUpdatedActivity({ summary: summary(), unexpected: true }),
    ).toBeUndefined();
    expect(
      decodeSubagentSummaryUpdatedActivity({
        summary: { ...summary(), error: "x".repeat(4_097) },
      }),
    ).toBeUndefined();
  });

  it("keeps the latest summary for each display id", () => {
    const latest = summary({ status: "done", outcome: "completed" });
    const folded = foldSubagentSummaries([
      { kind: SUBAGENT_SUMMARY_UPDATED_ACTIVITY, payload: { summary: summary() } },
      { kind: SUBAGENT_SUMMARY_UPDATED_ACTIVITY, payload: { summary: latest } },
    ]);
    expect(folded).toEqual([latest]);
  });

  it("sorts summaries newest first without mutating the initial summaries", () => {
    const older = summary();
    const newer = summary({
      threadId: ThreadId.make("t3-internal-subagent-child-2"),
      displayId: SubagentId.make("sa-2"),
      createdAt: "2026-07-23T00:00:00.000Z",
    });
    const initial = [older, newer];

    expect(foldSubagentSummaries([], initial)).toEqual([newer, older]);
    expect(initial).toEqual([older, newer]);
  });

  it("counts running, completed, failed, and attention states", () => {
    const summaries = [
      summary(),
      summary({
        threadId: ThreadId.make("t3-internal-subagent-child-2"),
        displayId: SubagentId.make("sa-2"),
        status: "done",
        outcome: "completed",
      }),
      summary({
        threadId: ThreadId.make("t3-internal-subagent-child-3"),
        displayId: SubagentId.make("sa-3"),
        status: "error",
        outcome: "failed",
        hasPendingApproval: true,
      }),
    ];
    expect(foldSubagentCounts(summaries)).toEqual({
      running: 1,
      done: 1,
      failed: 1,
      needsAttention: 1,
    });
    expect(
      hasBlockingSubagents([
        { kind: SUBAGENT_SUMMARY_UPDATED_ACTIVITY, payload: { summary: summaries[0] } },
      ]),
    ).toBe(true);
  });

  it("classifies only exact bookkeeping activity names", () => {
    expect(isSubagentBookkeepingActivity({ kind: SUBAGENT_METADATA_ACTIVITY })).toBe(true);
    expect(isSubagentBookkeepingActivity({ kind: SUBAGENT_SUMMARY_UPDATED_ACTIVITY })).toBe(true);
    expect(isSubagentBookkeepingActivity({ kind: "fork.subagent.summary.updated.extra" })).toBe(
      false,
    );
  });
});

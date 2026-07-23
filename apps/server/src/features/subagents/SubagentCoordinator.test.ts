import { ThreadId, type OrchestrationThread } from "@t3tools/contracts";
import { SUBAGENT_RUN_SETTLED_ACTIVITY } from "@t3tools/fork-subagents/activities";
import { describe, expect, it } from "vite-plus/test";

import { __testing } from "./SubagentCoordinator.ts";

describe("SubagentCoordinator", () => {
  it("bounds tool output", () => {
    const output = __testing.truncateText("one\ntwo\nthree", 100, 2);
    expect(output.truncated).toBe(true);
    expect(output.text).toContain("[truncated; open the child thread for full output]");

    const latest = __testing.truncateLatestText("one\ntwo\nthree", 100, 2);
    expect(latest.truncated).toBe(true);
    expect(latest.text).toContain("two\nthree");
    expect(latest.text).not.toContain("\none\n");
  });

  it("reference-counts overlapping waits until every waiter releases interest", () => {
    const childOne = ThreadId.make("child-1");
    const childTwo = ThreadId.make("child-2");
    const firstWait = __testing.adjustWaitInterests(new Map(), [childOne, childTwo], 1);
    const secondWait = __testing.adjustWaitInterests(firstWait, [childOne], 1);

    expect(secondWait.get(childOne)).toBe(2);
    expect(secondWait.get(childTwo)).toBe(1);

    const firstRelease = __testing.adjustWaitInterests(secondWait, [childOne, childTwo], -1);
    expect(firstRelease.get(childOne)).toBe(1);
    expect(firstRelease.has(childTwo)).toBe(false);

    const finalRelease = __testing.adjustWaitInterests(firstRelease, [childOne], -1);
    expect(finalRelease.size).toBe(0);
  });

  it("does not reuse a previous result after a continuation is queued", () => {
    const previousResult = {
      childTurnId: "turn-1",
      outcome: "completed",
      error: null,
      state: "pending",
      deliveryMessageId: "617c3db8-f600-5d3b-a831-41f4eebdea83",
      settledAt: "2026-07-22T00:01:00.000Z",
    };
    const thread = {
      latestTurn: { turnId: "turn-1" },
      messages: [
        { role: "user", createdAt: "2026-07-22T00:00:00.000Z" },
        { role: "user", createdAt: "2026-07-22T00:02:00.000Z" },
      ],
      activities: [{ kind: SUBAGENT_RUN_SETTLED_ACTIVITY, payload: { result: previousResult } }],
    } as unknown as OrchestrationThread;

    expect(__testing.currentRunResult(thread)).toBeUndefined();

    const continuationResult = {
      ...previousResult,
      childTurnId: "turn-2",
      settledAt: "2026-07-22T00:03:00.000Z",
    };
    const settledContinuation = {
      ...thread,
      latestTurn: { turnId: "turn-2" },
      activities: [
        ...thread.activities,
        { kind: SUBAGENT_RUN_SETTLED_ACTIVITY, payload: { result: continuationResult } },
      ],
    } as unknown as OrchestrationThread;
    expect(__testing.currentRunResult(settledContinuation)?.childTurnId).toBe("turn-2");
  });

  it("tracks only unresolved child approvals and structured input", () => {
    const thread = {
      activities: [
        { kind: "approval.requested", payload: { requestId: "approval-1" } },
        { kind: "approval.resolved", payload: { requestId: "approval-1" } },
        { kind: "approval.requested", payload: { requestId: "approval-2" } },
        { kind: "user-input.requested", payload: { requestId: "input-1" } },
      ],
    } as unknown as OrchestrationThread;

    expect(__testing.pendingAttention(thread)).toEqual({
      hasPendingApproval: true,
      hasPendingUserInput: true,
    });
  });
});

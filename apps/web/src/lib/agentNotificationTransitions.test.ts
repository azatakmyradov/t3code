import { describe, expect, it } from "vite-plus/test";

import {
  computeAgentNotifications,
  type ThreadNotificationSignature,
} from "./agentNotificationTransitions";

const idle: ThreadNotificationSignature = {
  turnState: "running",
  hasPendingApproval: false,
  hasPendingInput: false,
};

const TITLE = "Fix the bug";

describe("computeAgentNotifications", () => {
  it("seeds silently on first observation (no previous signature)", () => {
    const result = computeAgentNotifications(
      undefined,
      { turnState: "completed", hasPendingApproval: false, hasPendingInput: false },
      TITLE,
    );
    expect(result).toEqual([]);
  });

  it("notifies on running → completed", () => {
    const result = computeAgentNotifications(idle, { ...idle, turnState: "completed" }, TITLE);
    expect(result).toEqual([{ kind: "completed", title: TITLE, body: "Agent finished" }]);
  });

  it("notifies on running → error", () => {
    const result = computeAgentNotifications(idle, { ...idle, turnState: "error" }, TITLE);
    expect(result).toEqual([{ kind: "error", title: TITLE, body: "Agent failed" }]);
  });

  it("does not notify on running → interrupted", () => {
    const result = computeAgentNotifications(idle, { ...idle, turnState: "interrupted" }, TITLE);
    expect(result).toEqual([]);
  });

  it("notifies when a pending approval appears (false → true)", () => {
    const result = computeAgentNotifications(idle, { ...idle, hasPendingApproval: true }, TITLE);
    expect(result).toEqual([{ kind: "approval", title: TITLE, body: "Needs approval" }]);
  });

  it("notifies when a pending user input appears (false → true)", () => {
    const result = computeAgentNotifications(idle, { ...idle, hasPendingInput: true }, TITLE);
    expect(result).toEqual([{ kind: "input", title: TITLE, body: "Needs your input" }]);
  });

  it("does not notify on a repeated identical signature", () => {
    const next: ThreadNotificationSignature = {
      turnState: "completed",
      hasPendingApproval: false,
      hasPendingInput: false,
    };
    const result = computeAgentNotifications(next, next, TITLE);
    expect(result).toEqual([]);
  });

  it("does not re-notify while a pending approval stays open", () => {
    const open: ThreadNotificationSignature = { ...idle, hasPendingApproval: true };
    const result = computeAgentNotifications(open, open, TITLE);
    expect(result).toEqual([]);
  });

  it("falls back to a generic title when the thread title is blank", () => {
    const result = computeAgentNotifications(idle, { ...idle, turnState: "completed" }, "   ");
    expect(result).toEqual([{ kind: "completed", title: "Agent", body: "Agent finished" }]);
  });

  it("can emit a turn-completed and an input-requested notification together", () => {
    const result = computeAgentNotifications(
      idle,
      { turnState: "completed", hasPendingApproval: false, hasPendingInput: true },
      TITLE,
    );
    expect(result).toEqual([
      { kind: "completed", title: TITLE, body: "Agent finished" },
      { kind: "input", title: TITLE, body: "Needs your input" },
    ]);
  });
});

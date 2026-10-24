import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";

import {
  providerQuotaStatus,
  formatStatusPercent,
  selectThreadContext,
} from "./providerUsage.logic";

const now = Date.parse("2026-10-10T12:00:00Z");
const session: ServerProviderUsageWindow = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  windowDurationMins: 300,
  usedPercent: 12,
  resetsAt: "2026-10-10T15:00:00Z",
};
const weekly: ServerProviderUsageWindow = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  windowDurationMins: 10_080,
  usedPercent: 62,
};
const limits: ServerProviderUsageLimits = {
  checkedAt: "2026-10-10T11:59:00Z",
  windows: [weekly, session],
};

describe("provider quota status", () => {
  it("shows remaining percentages in session/weekly order without mutating the snapshot", () => {
    const status = providerQuotaStatus({ usageLimits: limits }, now);
    expect(
      status.windows.map(({ shortLabel, remainingPercent }) => [shortLabel, remainingPercent]),
    ).toEqual([
      ["5h", 88],
      ["Week", 38],
    ]);
    expect(limits.windows[0]?.id).toBe("seven_day");
    expect(limits.windows.map((window) => window.usedPercent)).toEqual([62, 12]);
  });

  it("preserves monthly and model-specific scopes rather than inventing five-hour limits", () => {
    const status = providerQuotaStatus(
      {
        usageLimits: {
          ...limits,
          windows: [
            { ...weekly, id: "seven_day_opus", label: "Weekly · Opus" },
            {
              ...session,
              id: "primary",
              kind: "monthly",
              label: "Monthly",
              windowDurationMins: 43_200,
            },
            { ...session, id: "short", windowDurationMins: 60 },
          ],
        },
      },
      now,
    );
    expect(status.windows.map(({ shortLabel }) => shortLabel)).toEqual([
      "Session",
      "Week · Opus",
      "Monthly",
    ]);
  });

  it("keeps OpenCode Go quotas explicitly scoped to Go", () => {
    const status = providerQuotaStatus(
      {
        usageLimits: {
          ...limits,
          windows: [
            { ...session, id: "go_rolling", label: "Go · Session" },
            { ...weekly, id: "go_weekly", label: "Go · Weekly" },
          ],
        },
      },
      now,
    );
    expect(status.windows.map(({ shortLabel }) => shortLabel)).toEqual(["Go 5h", "Go week"]);
  });

  it("keeps a failed probe's retained values visibly stale", () => {
    const status = providerQuotaStatus(
      { usageLimits: { ...limits, unavailable: { reason: "probeFailed" } } },
      now,
    );
    expect(status.stale).toBe(true);
    expect(status.windows[0]?.remainingPercent).toBe(88);
  });

  it("does not invent a full or empty remaining quota after a reset", () => {
    const status = providerQuotaStatus({ usageLimits: limits }, Date.parse(session.resetsAt!));
    expect(status.windows[0]?.remainingPercent).toBeNull();
    expect(status.windows[1]?.remainingPercent).toBe(38);
  });

  it.each([
    [null, false],
    [{}, false],
    [{ usageLimits: { ...limits, unavailable: { reason: "unsupported" as const } } }, false],
    [{ usageLimits: limits }, true],
  ])("clears unavailable or disconnected account values", (provider, disconnected) => {
    const status = providerQuotaStatus(provider, now, disconnected);
    expect(status.windows).toEqual([]);
    expect(status.unavailable).not.toBeNull();
  });

  it("inverts the clamped usage range and keeps non-finite values unknown", () => {
    const status = providerQuotaStatus(
      {
        usageLimits: {
          ...limits,
          windows: [0, 100, -1, 110, 99.5, Number.NaN, Infinity, -Infinity].map(
            (usedPercent, index) => ({
              ...session,
              id: String(index),
              usedPercent,
            }),
          ),
        },
      },
      now,
    );
    expect(status.windows.map(({ remainingPercent }) => remainingPercent)).toEqual([
      100,
      0,
      100,
      0,
      0.5,
      null,
      null,
      null,
    ]);
  });
});

it("formats small percentages without confusing missing data with zero", () => {
  expect([null, 0, 0.5, 5, 62.4, 100, Number.NaN].map(formatStatusPercent)).toEqual([
    "-",
    "0%",
    "0.5%",
    "5%",
    "62%",
    "100%",
    "-",
  ]);
});

describe("selected-thread context scope", () => {
  const selectedModel = {
    instanceId: ProviderInstanceId.make("claude-work"),
    model: "claude-opus-5-5",
  };
  const context = deriveLatestContextWindowSnapshot([], {
    usedTokens: 10_000,
    maxTokens: 200_000,
    updatedAt: "2026-10-10T11:59:00Z",
  });
  const input: Parameters<typeof selectThreadContext>[0] = {
    selectedModel,
    provider: {
      instanceId: selectedModel.instanceId,
      driver: ProviderDriverKind.make("claudeAgent"),
    },
    context,
    contextModelSelection: selectedModel,
  };

  it("returns context only for the selected provider account and model", () => {
    expect(selectThreadContext(input)).toBe(context);
    expect(selectThreadContext({ ...input, provider: null })).toBeNull();
    expect(selectThreadContext({ ...input, contextModelSelection: null })).toBeNull();
    expect(
      selectThreadContext({
        ...input,
        selectedModel: { ...selectedModel, instanceId: ProviderInstanceId.make("claude-personal") },
      }),
    ).toBeNull();
    expect(
      selectThreadContext({
        ...input,
        contextModelSelection: {
          ...selectedModel,
          instanceId: ProviderInstanceId.make("claude-personal"),
        },
      }),
    ).toBeNull();
    expect(
      selectThreadContext({
        ...input,
        contextModelSelection: { ...selectedModel, model: "claude-sonnet-5-5" },
      }),
    ).toBeNull();
  });
});

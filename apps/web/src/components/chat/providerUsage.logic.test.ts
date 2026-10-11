import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { providerQuotaStatus, formatStatusPercent, selectThreadUsage } from "./providerUsage.logic";

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
  it("shows used percentages in session/weekly order without mutating the snapshot", () => {
    const status = providerQuotaStatus({ usageLimits: limits }, now);
    expect(status.windows.map(({ shortLabel, usedPercent }) => [shortLabel, usedPercent])).toEqual([
      ["5h", 12],
      ["Week", 62],
    ]);
    expect(limits.windows[0]?.id).toBe("seven_day");
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
    expect(status.windows[0]?.usedPercent).toBe(12);
  });

  it("does not present expired windows as either fresh usage or zero", () => {
    const status = providerQuotaStatus({ usageLimits: limits }, Date.parse(session.resetsAt!));
    expect(status.windows[0]?.usedPercent).toBeNull();
    expect(status.windows[1]?.usedPercent).toBe(62);
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

  it("keeps a true zero and clamps malformed percentages", () => {
    const status = providerQuotaStatus(
      {
        usageLimits: {
          ...limits,
          windows: [0, -1, 110, Number.NaN].map((usedPercent, index) => ({
            ...session,
            id: String(index),
            usedPercent,
          })),
        },
      },
      now,
    );
    expect(status.windows.map(({ usedPercent }) => usedPercent)).toEqual([0, 0, 100, null]);
  });
});

it("formats small percentages without confusing missing data with zero", () => {
  expect([null, 0, 0.5, 5, 62.4, 100, Number.NaN].map(formatStatusPercent)).toEqual([
    "—",
    "0%",
    "0.5%",
    "5%",
    "62%",
    "100%",
    "—",
  ]);
});

describe("selected-thread usage scope", () => {
  const selectedModel = {
    instanceId: ProviderInstanceId.make("claude-work"),
    model: "claude-opus-5-5",
  };
  const input: Parameters<typeof selectThreadUsage>[0] = {
    selectedModel,
    provider: {
      instanceId: selectedModel.instanceId,
      driver: ProviderDriverKind.make("claudeAgent"),
    },
    context: null,
    contextModelSelection: null,
    throughput: null,
  };
  it("rejects a stale snapshot from another account even when the driver and model match", () => {
    expect(
      selectThreadUsage({
        ...input,
        selectedModel: { ...selectedModel, instanceId: ProviderInstanceId.make("claude-personal") },
      }),
    ).toEqual({ context: null, tokensPerSecond: null });
  });

  it("does not substitute another account or model's completed turn rate", () => {
    const throughput = {
      providerInstanceId: selectedModel.instanceId,
      modelSelection: selectedModel,
      tokensPerSecond: 91,
      outputTokens: 910,
      durationMs: 10_000,
    };
    expect(selectThreadUsage({ ...input, throughput }).tokensPerSecond).toBe(91);
    expect(
      selectThreadUsage({
        ...input,
        throughput: {
          ...throughput,
          modelSelection: {
            ...selectedModel,
            instanceId: ProviderInstanceId.make("claude-personal"),
          },
        },
      }).tokensPerSecond,
    ).toBeNull();
    expect(
      selectThreadUsage({
        ...input,
        throughput: {
          ...throughput,
          modelSelection: { ...selectedModel, model: "claude-sonnet-5-5" },
        },
      }).tokensPerSecond,
    ).toBeNull();
  });
});

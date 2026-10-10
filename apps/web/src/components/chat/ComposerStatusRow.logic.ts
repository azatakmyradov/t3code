import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

const WINDOW_ORDER = { session: 0, weekly: 1, monthly: 2, other: 3 } as const;

function compactWindowLabel(window: ServerProviderUsageWindow): string {
  if (window.label === "Session" && window.windowDurationMins === 300) return "5h";
  if (window.label === "Weekly") return "Week";
  if (window.label === "Go · Session" && window.windowDurationMins === 300) return "Go 5h";
  if (window.label === "Go · Weekly") return "Go week";
  if (window.label === "Go · Monthly") return "Go month";
  return window.label.replace(/^Weekly · /, "Week · ");
}

/** Keep quota tied to the selected instance; another account's allowance is not a fallback. */
export function composerQuotaStatus(
  provider: Pick<ServerProvider, "usageLimits"> | null,
  now: number,
  disconnected = false,
) {
  const limits = provider?.usageLimits;
  const unavailable = disconnected
    ? "Reconnect to see this provider's usage limits."
    : limits?.unavailable?.reason === "unsupported"
      ? (limits.unavailable.message ??
        "This provider or account does not report subscription limits.")
      : limits === undefined || limits.windows.length === 0
        ? (limits?.unavailable?.message ??
          "No subscription usage has been reported for this account.")
        : null;
  const stale = limits?.unavailable?.reason === "probeFailed";
  const windows = unavailable !== null ? [] : [...(limits?.windows ?? [])];
  return {
    unavailable,
    stale,
    checkedAt: limits?.checkedAt ?? null,
    windows: windows
      .sort((left, right) => WINDOW_ORDER[left.kind] - WINDOW_ORDER[right.kind])
      .map((window) => ({
        ...window,
        shortLabel: compactWindowLabel(window),
        // A passed reset does not prove the account now has an empty bucket.
        usedPercent:
          !Number.isFinite(window.usedPercent) ||
          (window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now)
            ? null
            : Math.max(0, Math.min(100, window.usedPercent)),
      })),
  };
}

export function formatStatusPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const percent = Math.max(0, Math.min(100, value));
  return `${percent < 10 ? Number(percent.toFixed(1)) : Math.round(percent)}%`;
}

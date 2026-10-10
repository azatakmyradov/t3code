import type { ModelSelection, ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";

import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import type { TurnThroughput } from "../../lib/turnThroughput";

const WINDOW_ORDER = { session: 0, weekly: 1, monthly: 2, other: 3 } as const;

export function usageModelMatchesSelection(
  selected: ModelSelection,
  reported: ModelSelection | null,
  driver: ServerProvider["driver"],
) {
  const model = normalizeModelSlug(selected.model, driver);
  return (
    reported !== null &&
    selected.instanceId === reported.instanceId &&
    model !== null &&
    model === normalizeModelSlug(reported.model, driver)
  );
}

function windowAppliesToModel(
  window: ServerProviderUsageWindow,
  driver: ServerProvider["driver"],
  model: string,
) {
  if (driver === "opencode" && window.id.startsWith("go_")) {
    return model.startsWith("opencode-go/");
  }
  if (driver !== "claudeAgent" || !window.id.startsWith("seven_day_")) return true;
  // Claude names scoped windows from the provider's display name. Match whole
  // tokens so a Sonnet bucket cannot appear for Opus or an unrelated alias.
  const scope = window.id.slice("seven_day_".length).split("_").filter(Boolean);
  const modelTokens = model
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return (
    scope.length > 0 &&
    modelTokens.some((_, index) =>
      scope.every((token, offset) => modelTokens[index + offset] === token),
    )
  );
}

/** Every metric follows the picker immediately, including before a new turn starts. */
export function selectComposerUsage(input: {
  provider: Pick<ServerProvider, "instanceId" | "driver" | "usageLimits"> | null;
  selectedModel: ModelSelection;
  context: ContextWindowSnapshot | null;
  contextModelSelection: ModelSelection | null;
  throughput: TurnThroughput | null;
}) {
  const provider =
    input.provider?.instanceId === input.selectedModel.instanceId ? input.provider : null;
  if (provider === null) return { provider: null, context: null, tokensPerSecond: null };
  const model = normalizeModelSlug(input.selectedModel.model, provider.driver) ?? "";
  const limits = provider.usageLimits;
  const windows = limits?.windows.filter((window) =>
    windowAppliesToModel(window, provider.driver, model),
  );
  return {
    provider:
      limits && windows
        ? {
            ...provider,
            usageLimits: {
              ...limits,
              windows,
              ...(limits.windows.length > 0 && windows.length === 0
                ? {
                    unavailable: {
                      reason: "unsupported" as const,
                      message: "No subscription quota is reported for the selected model.",
                    },
                  }
                : {}),
            },
          }
        : provider,
    context: usageModelMatchesSelection(
      input.selectedModel,
      input.contextModelSelection,
      provider.driver,
    )
      ? input.context
      : null,
    tokensPerSecond:
      input.throughput &&
      usageModelMatchesSelection(
        input.selectedModel,
        input.throughput.modelSelection,
        provider.driver,
      )
        ? input.throughput.tokensPerSecond
        : null,
  };
}

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

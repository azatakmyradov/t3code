import type {
  ModelSelection,
  ServerProvider,
  ServerProviderUsageWindow,
  ServerSettings,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";

import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { providerClients } from "../settings/providerDriverMeta";

/** Remove deleted custom accounts before the next provider snapshot reconciles. */
export function selectConfiguredUsageProviders(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: Pick<ServerSettings, "providerInstances">,
) {
  return entries.filter((entry) => {
    if (Object.hasOwn(settings.providerInstances, entry.instanceId)) return true;
    const definition = providerClients.get(entry.driverKind);
    return entry.isDefault && definition !== undefined && definition.hasDefaultInstance !== false;
  });
}

/** Subscription quota remains machine-wide when a project's model picker disables an account. */
export function deriveUsageProviderEntries(
  providers: ReadonlyArray<ServerProvider>,
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
) {
  return selectConfiguredUsageProviders(
    sortProviderInstanceEntries(
      applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, null),
    ),
    settings,
  );
}

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

/** Thread context belongs only to the selected account and model, never every quota group. */
export function selectThreadContext(input: {
  provider: Pick<ServerProvider, "instanceId" | "driver"> | null;
  selectedModel: ModelSelection;
  context: ContextWindowSnapshot | null;
  contextModelSelection: ModelSelection | null;
}) {
  const provider = input.provider;
  return provider !== null &&
    provider.instanceId === input.selectedModel.instanceId &&
    usageModelMatchesSelection(input.selectedModel, input.contextModelSelection, provider.driver)
    ? input.context
    : null;
}

function compactWindowLabel(window: ServerProviderUsageWindow): string {
  if (window.label === "Session" && window.windowDurationMins === 300) return "5h";
  if (window.label === "Weekly") return "Week";
  if (window.label === "Go · Session" && window.windowDurationMins === 300) return "Go 5h";
  if (window.label === "Go · Weekly") return "Go week";
  if (window.label === "Go · Monthly") return "Go month";
  return window.label.replace(/^Weekly · /, "Week · ");
}

/** Keep each quota report tied to its own instance; never pool different accounts. */
export function providerQuotaStatus(
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
      .map((window) => {
        const { usedPercent, ...details } = window;
        return {
          ...details,
          shortLabel: compactWindowLabel(window),
          // An expired report does not prove the quota has reset to 100% available.
          remainingPercent:
            !Number.isFinite(usedPercent) ||
            (window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now)
              ? null
              : 100 - Math.max(0, Math.min(100, usedPercent)),
        };
      }),
  };
}

export function formatStatusPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const percent = Math.max(0, Math.min(100, value));
  return `${percent < 10 ? Number(percent.toFixed(1)) : Math.round(percent)}%`;
}

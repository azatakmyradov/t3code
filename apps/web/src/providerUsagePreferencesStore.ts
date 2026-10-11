import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage, type StateStorage } from "./lib/storage";

interface ProviderUsagePreferences {
  hiddenByEnvironment: Record<string, string[]>;
  setHidden: (
    environmentId: EnvironmentId,
    instanceId: ProviderInstanceId,
    hidden: boolean,
  ) => void;
  showAll: (environmentId: EnvironmentId) => void;
}
const EMPTY_HIDDEN: readonly string[] = [];

export function selectHiddenUsageProviderIds(
  state: Pick<ProviderUsagePreferences, "hiddenByEnvironment">,
  environmentId: EnvironmentId,
): readonly string[] {
  return Object.hasOwn(state.hiddenByEnvironment, environmentId)
    ? (state.hiddenByEnvironment[environmentId] ?? EMPTY_HIDDEN)
    : EMPTY_HIDDEN;
}

function persistedHiddenProviders(persisted: unknown): Record<string, string[]> {
  if (typeof persisted !== "object" || persisted === null || !("hiddenByEnvironment" in persisted))
    return {};
  const value = persisted.hiddenByEnvironment;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([environmentId, ids]) =>
      Array.isArray(ids)
        ? [
            [
              environmentId,
              [
                ...new Set(
                  ids.filter((id): id is string => typeof id === "string" && id.length > 0),
                ),
              ],
            ],
          ]
        : [],
    ),
  );
}

/** Local display choices only: never changes provider configuration or authentication. */
export function createProviderUsagePreferencesStore(storage?: StateStorage) {
  return create<ProviderUsagePreferences>()(
    persist(
      (set) => ({
        hiddenByEnvironment: {},
        setHidden: (environmentId, instanceId, hidden) =>
          set((state) => {
            const previous = selectHiddenUsageProviderIds(state, environmentId);
            if (previous.includes(instanceId) === hidden) return state;
            const next = hidden
              ? [...previous, instanceId]
              : previous.filter((id) => id !== instanceId);
            return { hiddenByEnvironment: { ...state.hiddenByEnvironment, [environmentId]: next } };
          }),
        showAll: (environmentId) =>
          set((state) => {
            if (!Object.hasOwn(state.hiddenByEnvironment, environmentId)) return state;
            const { [environmentId]: _removed, ...hiddenByEnvironment } = state.hiddenByEnvironment;
            return { hiddenByEnvironment };
          }),
      }),
      {
        name: "t3code:provider-usage-visibility:v1",
        storage: createJSONStorage(
          () =>
            storage ??
            resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
        ),
        partialize: (state) => ({ hiddenByEnvironment: state.hiddenByEnvironment }),
        merge: (persisted, current) => ({
          ...current,
          hiddenByEnvironment: persistedHiddenProviders(persisted),
        }),
      },
    ),
  );
}

export const useProviderUsagePreferencesStore = createProviderUsagePreferencesStore();

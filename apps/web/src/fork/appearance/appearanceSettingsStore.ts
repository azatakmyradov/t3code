import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_WEB_APPEARANCE_SETTINGS,
  type AppearanceSettings,
  normalizeAppearanceSettings,
} from "./appearanceDefaults";

const APPEARANCE_STORAGE_KEY = "t3code:fork:appearance";

const listeners = new Set<() => void>();
let snapshot = readStoredAppearanceSettings();

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readStoredAppearanceSettings(): AppearanceSettings {
  if (!hasStorage()) {
    return DEFAULT_WEB_APPEARANCE_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return normalizeAppearanceSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_WEB_APPEARANCE_SETTINGS;
  }
}

function writeStoredAppearanceSettings(settings: AppearanceSettings): void {
  if (!hasStorage()) {
    return;
  }

  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep the in-memory snapshot responsive even when browser storage fails.
  }
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getAppearanceSnapshot(): AppearanceSettings {
  return snapshot;
}

function getServerAppearanceSnapshot(): AppearanceSettings {
  return DEFAULT_WEB_APPEARANCE_SETTINGS;
}

function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  snapshot = readStoredAppearanceSettings();

  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_STORAGE_KEY) {
      return;
    }

    snapshot = readStoredAppearanceSettings();
    listener();
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function setAppearanceSettings(
  next: AppearanceSettings | ((current: AppearanceSettings) => AppearanceSettings),
): void {
  snapshot = normalizeAppearanceSettings(typeof next === "function" ? next(snapshot) : next);
  writeStoredAppearanceSettings(snapshot);
  emitChange();
}

export function resetAppearanceSettings(): void {
  setAppearanceSettings(DEFAULT_WEB_APPEARANCE_SETTINGS);
}

export function useAppearanceSettings(): {
  readonly appearance: AppearanceSettings;
  readonly setAppearance: (
    next: AppearanceSettings | ((current: AppearanceSettings) => AppearanceSettings),
  ) => void;
  readonly resetAppearance: () => void;
} {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getServerAppearanceSnapshot,
  );

  return {
    appearance,
    setAppearance: useCallback((next) => setAppearanceSettings(next), []),
    resetAppearance: useCallback(() => resetAppearanceSettings(), []),
  };
}

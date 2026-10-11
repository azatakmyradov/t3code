import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { createMemoryStorage } from "./lib/storage";
import {
  createProviderUsagePreferencesStore,
  selectHiddenUsageProviderIds,
} from "./providerUsagePreferencesStore";

const work = EnvironmentId.make("work");
const home = EnvironmentId.make("home");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

it("persists visibility per environment and provider instance across reloads", () => {
  const storage = createMemoryStorage();
  const first = createProviderUsagePreferencesStore(storage);
  expect(selectHiddenUsageProviderIds(first.getState(), work)).toEqual([]);
  first.getState().setHidden(work, codex, true);
  first.getState().setHidden(work, codex, true);
  first.getState().setHidden(home, claude, true);
  const reloaded = createProviderUsagePreferencesStore(storage);
  expect(selectHiddenUsageProviderIds(reloaded.getState(), work)).toEqual([codex]);
  expect(selectHiddenUsageProviderIds(reloaded.getState(), home)).toEqual([claude]);
  reloaded.getState().setHidden(work, codex, false);
  const restored = createProviderUsagePreferencesStore(storage);
  expect(selectHiddenUsageProviderIds(restored.getState(), work)).toEqual([]);
  expect(selectHiddenUsageProviderIds(restored.getState(), home)).toEqual([claude]);
});

it("show all restores only the chosen environment and persists", () => {
  const storage = createMemoryStorage();
  const store = createProviderUsagePreferencesStore(storage);
  store.getState().setHidden(work, codex, true);
  store.getState().setHidden(work, claude, true);
  store.getState().setHidden(home, codex, true);
  store.getState().showAll(work);
  const reloaded = createProviderUsagePreferencesStore(storage);
  expect(selectHiddenUsageProviderIds(reloaded.getState(), work)).toEqual([]);
  expect(selectHiddenUsageProviderIds(reloaded.getState(), home)).toEqual([codex]);
});

it("ignores malformed persisted lists and does not inherit object keys", () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "t3code:provider-usage-visibility:v1",
    JSON.stringify({
      state: {
        hiddenByEnvironment: {
          work: ["codex", null, 1, "codex", ""],
          home: "invalid",
        },
      },
      version: 0,
    }),
  );
  const store = createProviderUsagePreferencesStore(storage);
  expect(selectHiddenUsageProviderIds(store.getState(), work)).toEqual([codex]);
  expect(selectHiddenUsageProviderIds(store.getState(), home)).toEqual([]);
  const special = EnvironmentId.make("constructor");
  expect(selectHiddenUsageProviderIds(store.getState(), special)).toEqual([]);
  store.getState().setHidden(special, codex, true);
  expect(selectHiddenUsageProviderIds(store.getState(), special)).toEqual([codex]);
});

# Builder Model Selection

Status: current fork-local change.

## Summary

- Adds a settings-backed `builderModelSelection` (its own provider instance +
  model + options), independent from `textGenerationModelSelection`. Default is
  the `codex` instance with `DEFAULT_BUILDER_MODEL` (= `DEFAULT_MODEL`).
- Adds an "Implement with builder" item to the composer's plan primary-action
  menu, next to "Implement in a new thread". It starts the plan-implementation
  thread using the configured builder model instead of the composer's current
  model.
- Adds a "Builder model" row to Settings > General (model picker + traits
  picker), with reset-to-default and restore-defaults support.

## Why

When implementing a ready plan in a new thread, the planning model is often not
the model you want to do the implementation. A dedicated builder model lets the
user pick (and persist) the implementation model once, then kick off
implementation with one click without re-selecting the model each time.

## How

- The plan-implementation flow in `ChatView` is refactored: the thread
  create + turn start + navigate logic is extracted into
  `startPlanImplementationThread(modelContext)`, parameterized by an
  `AppModelSelectionDispatchContext`. "Implement in a new thread" passes the
  composer's current send context; "Implement with builder" resolves the
  builder selection via `resolveAppBuilderModelSelectionState` and
  `resolveAppModelSelectionDispatchContext`.
- `modelSelection.ts` factors the text-gen resolver into a shared
  `resolveSettingsModelSelectionState` / `resolveAppModelSelectionDispatchContext`
  pair (returns provider, model, models, prompt effort, and selection), used by
  both the text-gen and builder resolvers. The dispatch-context resolver also
  hardens the no-provider / fallback paths (falls back to default-by-provider
  then default model, keeps the selected provider when still enabled/available).
- Server- and shared-side handling is generalized to iterate over both model
  selection keys (`MODEL_SELECTION_SETTINGS_KEYS`):
  - `apps/server/src/serverSettings.ts`: `resolveEnabledModelSelectionProviders`
    (was `resolveTextGenerationProvider`) re-points each selection to an enabled
    provider at read-time, falling back via that key's defaults. Fallback now
    prefers an enabled `providerInstances` entry, then an enabled legacy
    provider.
  - `packages/shared/src/serverSettings.ts`: `applyServerSettingsPatch` treats
    both selections as atomic whole-object replacements (not deep-merged), with
    per-key option merge via `shouldReplaceModelSelection`.
  - Both keys added to `ATOMIC_SETTINGS_KEYS`.

## Files

- `packages/contracts/src/model.ts`: adds `DEFAULT_BUILDER_MODEL` and
  `DEFAULT_BUILDER_MODEL_BY_PROVIDER` (aliases of the base model defaults).
- `packages/contracts/src/settings.ts`: adds `builderModelSelection` to
  `ServerSettings` (decoding default = `codex` / `DEFAULT_BUILDER_MODEL`) and
  the optional `builderModelSelection` key to `ServerSettingsPatch`.
- `apps/server/src/serverSettings.ts`: generalizes enabled-provider resolution
  and fallback over both model selection keys; adds `builderModelSelection` to
  `ATOMIC_SETTINGS_KEYS`.
- `packages/shared/src/serverSettings.ts`: generalizes patch application over
  both keys (atomic replacement + option merge).
- `apps/web/src/modelSelection.ts`: adds `resolveAppBuilderModelSelectionState`,
  `resolveAppModelSelectionDispatchContext`, the `AppModelSelectionDispatchContext`
  type, and the shared `resolveSettingsModelSelectionState` resolver.
- `apps/web/src/components/ChatView.tsx`: extracts `startPlanImplementationThread`
  and adds `onImplementPlanWithBuilder`; wires it through to the composer.
- `apps/web/src/components/chat/ChatComposer.tsx` and
  `apps/web/src/components/chat/ComposerPrimaryActions.tsx`: thread the
  `onImplementPlanWithBuilder` callback through and add the "Implement with
  builder" menu item.
- `apps/web/src/components/settings/SettingsPanels.tsx`: adds the reusable
  `SettingsModelSelectionControl` (extracted from the git/text-gen row), the
  "Builder model" settings row, dirty/reset wiring, and provider-instance delete
  handling that resets the builder selection when its instance is removed.
- `apps/web/src/components/settings/SettingsPanels.logic.ts`: adds
  `builderModelSelection` to `buildProviderInstanceUpdatePatch`.
- Tests: `apps/server/src/serverSettings.test.ts`,
  `packages/shared/src/serverSettings.test.ts`,
  `packages/contracts/src/settings.test.ts`,
  `apps/web/src/modelSelection.test.ts`,
  `apps/web/src/components/settings/SettingsPanels.logic.test.ts`, and
  `apps/web/src/components/ChatView.browser.tsx` /
  `apps/web/src/components/settings/SettingsPanels.browser.tsx` cover schema
  defaults, patch application, selection resolution/fallback, and the builder
  settings UI + implement-with-builder action.

## Merge Notes

- If upstream changes settings schemas, preserve `builderModelSelection` as a
  decoded default of `codex` / `DEFAULT_BUILDER_MODEL` and keep the patch
  optional key.
- If upstream changes settings patch merging or read-time provider resolution,
  keep both model selections handled uniformly (`MODEL_SELECTION_SETTINGS_KEYS`)
  and atomic (whole-object replacement, not deep merge).
- If upstream refactors the plan-implementation flow, keep
  `startPlanImplementationThread` parameterized by model context so both the
  composer-model and builder-model entry points share it.
- If upstream changes the composer primary-action menu, preserve the "Implement
  with builder" item and its `onImplementPlanWithBuilder` plumbing.

## Verification

- Required project checks: `vp check` and `vp run typecheck`.

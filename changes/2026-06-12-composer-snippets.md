# Composer Snippets

Status: current fork-local change.

## Summary

- Adds settings-backed chat snippets with `keyword` and `value`.
- Adds a Settings > Snippets page for managing reusable prompt text.
- Detects `:keyword` in the composer, shows matching snippets, and inserts the
  saved snippet value exactly.

## Why

This keeps reusable prompt text available inside the composer without requiring
users to paste or retype common instructions.

## Files

- `packages/contracts/src/settings.ts`: adds `ChatSnippet`, `snippets`, and
  patch schema support.
- `packages/shared/src/serverSettings.ts`: treats snippets as a whole-array
  replacement during settings patch application.
- `packages/shared/src/composerTrigger.ts` and `apps/web/src/composer-logic.ts`:
  detect `:` snippet triggers.
- `apps/web/src/components/chat/ChatComposer.tsx`,
  `apps/web/src/components/chat/ComposerCommandMenu.tsx`, and
  `apps/web/src/components/chat/composerSnippetSearch.ts`: add snippet menu
  items, search, empty state, and insertion behavior.
- `apps/web/src/components/settings/SnippetsSettings.tsx`,
  `apps/web/src/components/settings/SettingsPanels.browser.tsx`,
  `apps/web/src/components/settings/SettingsSidebarNav.tsx`,
  `apps/web/src/routes/settings.snippets.tsx`, and
  `apps/web/src/routeTree.gen.ts`: add the settings UI and route.
- Tests cover settings schema defaults/validation, settings patch application,
  trigger detection, snippet search, composer logic, and full composer insertion.

## Merge Notes

- If upstream changes settings schemas, preserve `snippets` as a decoded default
  of `[]` and keep duplicate keyword validation.
- If upstream changes settings patch merging, keep snippets as a whole-array
  replacement rather than a deep merge.
- If upstream changes composer trigger detection or command menu grouping,
  preserve `snippet` as its own trigger kind and menu group.
- If upstream regenerates routes, rerun the local route generation workflow so
  `settings.snippets` remains registered.

## Verification

- Required project checks: `vp check` and `vp run typecheck`.

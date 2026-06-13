# Agent Notifications

Status: current fork-local change.

## Summary

- Adds a settings-backed `agentNotificationMode` (`off` / `on` /
  `when-not-focused`, default `when-not-focused`).
- Fires native Web `Notification`s when an agent finishes, fails, or starts
  needing attention (pending approval or pending user input).
- Adds a Settings > General "Agent notifications" row with a mode selector that
  requests notification permission and warns when it is blocked.
- Clicking a notification focuses the window and navigates to the relevant
  thread.

## Why

Long-running agents often finish or block on input while the user is in another
window. Native notifications surface these transitions without requiring the
user to keep the thread in view. `when-not-focused` is the default so focused
users aren't spammed.

## How

- A single Zustand store subscription (`agentNotificationWatcher`) diffs a
  per-thread signature (`turnState`, `hasPendingApproval`, `hasPendingInput`)
  across state updates. Because every transport path (live events, shell
  snapshots, recovered batches) converges in the store, one subscription is
  source-agnostic. First observation per thread is seeded silently so
  already-finished threads don't fire on page load.
- Transition logic is isolated in `agentNotificationTransitions.ts` (no
  store/DOM/runtime imports) so it is unit-testable.
- `notifyAgentEvent` reads the live settings snapshot, respects the mode and
  focus state, tags notifications by scoped thread key (with `renotify`), and
  navigates via a module-level router holder.

## Files

- `packages/contracts/src/settings.ts`: adds `AgentNotificationMode`,
  `DEFAULT_AGENT_NOTIFICATION_MODE`, the `ClientSettingsSchema` field (decoding
  default), and the `ClientSettingsPatch` optional key.
- `apps/web/src/lib/agentNotifications.ts`: Web Notification helpers
  (`supportsNotifications`, `isWindowFocused`, `ensureNotificationPermission`,
  `notifyAgentEvent`).
- `apps/web/src/lib/agentNotificationTransitions.ts`: pure transition logic
  (`computeAgentNotifications`).
- `apps/web/src/lib/agentNotificationWatcher.ts`: store subscription that diffs
  per-thread signatures and fires notifications.
- `apps/web/src/components/settings/SettingsPanels.tsx`: adds the "Agent
  notifications" settings row, mode labels, and permission request/blocked
  toast.
- `apps/web/src/environments/runtime/service.ts`: starts/stops the watcher with
  the environment connection service.
- `apps/web/src/router.ts` and `apps/web/src/main.tsx`: add a module-level
  router holder (`registerAppRouter` / `getAppRouter`) so notification click
  handlers can navigate without React context.
- Tests: `agentNotificationTransitions.test.ts` covers the transition matrix;
  `apps/web/src/localApi.test.ts` and
  `apps/desktop/src/settings/DesktopClientSettings.test.ts` add the new settings
  field to fixtures.

## Merge Notes

- If upstream changes settings schemas, preserve `agentNotificationMode` as a
  decoded default of `when-not-focused` and keep the patch optional key.
- If upstream adds its own notification system, reconcile so the watcher and any
  upstream notifier don't double-fire; this implementation is intentionally the
  single store-level sink.
- If upstream changes router bootstrap, keep `registerAppRouter` wired in
  `main.tsx` so notification click navigation works.
- If upstream changes the connection service lifecycle, keep
  `startAgentNotificationWatcher` started and stopped alongside it.
- Mobile push is untouched; this is browser/Electron-renderer only.

## Verification

- Required project checks: `vp check` and `vp run typecheck`.

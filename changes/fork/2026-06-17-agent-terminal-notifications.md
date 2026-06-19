# Agent Terminal Notifications

Status: current fork-local change.

## Summary

- Adds a desktop bridge for native Electron notifications.
- Sends notifications when an agent turn completes or fails outside the focused
  thread.
- Navigates back to the related thread when the native notification is clicked.
- Adds a desktop-only General Settings toggle for agent completion
  notifications, enabled by default.

## Why

This makes long-running agent work visible when T3 Code is in the background or
when the user is focused on another thread, without notifying for work already
visible in the active focused thread.

## Files

- `packages/contracts/src/ipc.ts`: adds notification input and activation
  payload schemas plus the desktop bridge methods.
- `packages/contracts/src/settings.ts`: adds
  `desktopAgentTerminalNotificationsEnabled` and patch support.
- `apps/desktop/src/electron/ElectronNotification.ts`: wraps Electron native
  notifications, handles unsupported or failed notification creation, and emits
  activation payloads after notification clicks.
- `apps/desktop/src/ipc/channels.ts`,
  `apps/desktop/src/ipc/methods/notifications.ts`,
  `apps/desktop/src/ipc/DesktopIpcHandlers.ts`, `apps/desktop/src/preload.ts`,
  and `apps/desktop/src/main.ts`: wire the notification service through desktop
  IPC and the preload bridge.
- `apps/web/src/fork/desktopNotifications/agentTerminalNotifications.logic.ts`: detects new
  completed or failed terminal turns, dedupes notification keys, and formats
  notification copy.
- `apps/web/src/fork/desktopNotifications/AgentTerminalNotificationCoordinator.tsx`: subscribes
  to store changes, suppresses focused active-thread notifications, respects the
  setting, sends notifications, and handles activation navigation.
- `apps/web/src/routes/__root.tsx`: mounts the coordinator for authenticated
  environments.
- `apps/web/src/components/settings/SettingsPanels.tsx`: adds the General
  Settings toggle and reset behavior for desktop builds.
- Tests cover Electron notification support/failure/click handling, terminal
  turn candidate detection and deduping, coordinator suppression and navigation,
  settings schema defaults/patches, and updated desktop bridge test stubs.

## Merge Notes

- If upstream changes `DesktopBridge`, preserve `showAgentNotification` and
  `onAgentNotificationActivated` as desktop-only bridge capabilities with
  schema-backed IPC payloads.
- If upstream changes settings defaults or restore behavior, keep
  `desktopAgentTerminalNotificationsEnabled` defaulting to `true` for legacy
  client settings and included in reset/restore summaries.
- If upstream changes thread route params or store shape, preserve notification
  activation navigation to `/$environmentId/$threadId` and active environment
  selection.
- If upstream changes turn state semantics, notify only for completed or error
  turns with a completion timestamp, and continue suppressing initially hydrated
  terminal turns.
- If upstream changes browser-test discovery, keep desktop browser tests
  included in the browser Vite test project.

## Verification

- Required project checks: `vp check` and `vp run typecheck`.

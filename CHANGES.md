# Fork Changes

Lightweight index of intentional fork-local changes. Use this during upstream
merges to decide what to preserve; keep detailed notes in `changes/`.

| Change                                                                                       | Area                                            | Notes                                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Composer snippets](changes/2026-06-12-composer-snippets.md)                                 | Web composer, settings, settings schema         | Adds reusable `:keyword` snippets and composer insertion.                            |
| [Agent notifications](changes/2026-06-13-agent-notifications.md)                             | Web lib, settings, settings schema, runtime svc | Native notifications on agent completed/error/approval/input; new `agentNotificationMode` setting. |
| [Desktop prod install keeps optional deps](changes/2026-06-13-desktop-prod-install-optional-deps.md) | Desktop build script                            | Drops `--no-optional` from staged `vp install --prod`.                              |

# Fork Changes

Lightweight index of intentional fork-local changes. Use this during upstream
merges to decide what to preserve; keep detailed notes in `changes/`.

| Change                                                                                  | Area                                        | Notes                                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| [Composer snippets](changes/fork/2026-06-12-composer-snippets.md)                       | Web composer, settings, settings schema     | Adds reusable `:keyword` snippets and composer insertion.                      |
| [Agent terminal notifications](changes/fork/2026-06-17-agent-terminal-notifications.md) | Desktop IPC, web shell, settings            | Shows native desktop notifications when background agent turns finish or fail. |
| [Review diff viewer](changes/fork/2026-06-19-review-diff-viewer.md)                     | Web chat header, fork diff viewer           | Full-screen working-tree diff viewer opened from a header "Review" button.     |
| [AI semantic diff groups](changes/fork/2026-06-20-semantic-diff-groups.md)              | Contracts, server textgen, fork diff viewer | Agentic AI clusters the full diff into risk-scored groups (Claude/Codex only). |

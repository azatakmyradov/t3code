# AI Semantic Diff Groups

Status: current fork-local change.

## Summary

- Adds an AI "semantic groups" mode to the fork review diff viewer. A new
  "Group with AI" button in the viewer header asks the operator-configured agent
  to cluster the reviewed diff into semantically-related groups.
- Grouping is **agentic**: the prompt no longer embeds the patch text. Instead
  the agent reproduces the exact diff the viewer shows by running git itself
  (`git diff HEAD` + reading untracked files for the working tree, or
  `git diff <base>...HEAD` for a branch range), so arbitrarily large diffs can be
  grouped without prompt-size limits. Because this needs file/command tools, the
  feature is **restricted to Claude and Codex** (whose invocation modes permit
  it); Cursor/Grok/OpenCode fail fast with a clear message and the web trigger is
  disabled (with an explanatory tooltip) for unsupported providers.
- Each group carries: a short title, a description (what it does), a
  "what changed" note, a "what to review" note, a 0-100 risk score with a
  colour-coded level (critical/high/medium/low), and a one-line risk reason.
- Groups are ordered most-critical first — in both the sidebar and (when groups
  mode is active) the diff pane itself, so the riskiest changes are reviewed
  first. A Files/Groups toggle switches the sidebar between the existing file
  tree and the grouped view; clicking a file in a group scrolls the diff to it,
  and the existing reviewed/selection/keyboard navigation keeps working.
- Files the model does not assign land in a synthetic "Other changes" group so
  every changed file is always reachable.
- A dedicated model can be chosen for grouping via Settings → General →
  "Semantic group model" (a fork-local `fork.reviewGroupsModelSelection`). When
  off it inherits the global text-generation model.

## Why

The fork review diff viewer made it easy to _see_ the whole working tree, but a
large diff is still a flat wall of files. Grouping the changes by concern and
surfacing the risky clusters first makes a self-review (or a teammate's review)
dramatically faster — you read the auth/migration/data-loss changes before the
formatting churn. The grouping reuses the same provider the app already uses for
commit-message / PR / branch-name generation, so there is no new model
configuration.

## Files

New, fork-local:

- `packages/contracts/src/forkReviewGroups.ts`: the RPC contract seam —
  `ReviewSemanticGroup`/`ReviewSemanticGroupsInput`/`ReviewSemanticGroupsResult`
  schemas, the `review.groupSemanticDiff` method name, the `Rpc.make`
  definition, and the `FORK_REVIEW_GROUPS_WS_METHODS` / `FORK_REVIEW_GROUPS_RPCS`
  aggregates spread into the base `rpc.ts`.
- `apps/server/src/fork/reviewGroups/reviewGroups.ts` (+ `.test.ts`): pure
  normalization — clamp the model's risk to a 0-100 int, derive the risk level,
  clean/dedupe file paths, drop empty groups, sort most-critical first, assign
  stable ids.
- `apps/server/src/fork/reviewGroups/rpcHandlers.ts` (+ `.test.ts`): the fork WS
  handler seam — `FORK_REVIEW_GROUPS_REQUIRED_SCOPE` +
  `makeForkReviewGroupsHandlers`. The handler reuses `review.getDiffPreview` to
  select the source, gates on the resolved driver kind (Claude/Codex only),
  passes the selected source's `kind`/`baseRef`/`headRef` scope to
  `textGeneration.generateSemanticDiffGroups`, and normalizes the result.
- `apps/server/src/fork/reviewGroups/index.ts`: barrel.
- `apps/web/src/fork/diffViewer/reviewGroupsState.ts`: the fork client command
  (`createEnvironmentRpcCommand`), mirroring `jiraEnvironment`.
- `apps/web/src/fork/diffViewer/reviewDiffGroupsModel.ts` (+ `.test.ts`):
  client reconciliation of model groups against the parsed `ReviewDiffFile`
  list, the "Other changes" backfill, and risk label/colour helpers.
- `apps/web/src/fork/diffViewer/ReviewDiffGroupsSidebar.tsx`: the grouped
  sidebar (risk badge, description, what-changed / review notes, file rows).
- `apps/web/src/fork/settingsPanels.tsx` (`ForkGeneralSettingsRows`): adds the
  "Semantic group model" row (inherit toggle + `ProviderModelPicker`) writing
  `fork.reviewGroupsModelSelection`. Now also renders the existing agent-
  notifications row.

Dedicated-model setting (fork-local, additive to existing fork seams):

- `packages/contracts/src/forkSettings.ts`: `reviewGroupsModelSelection`
  (`NullOr(ModelSelection)`, default `null`) on `ForkSettings` + `ForkSettingsPatch`.
- `packages/shared/src/forkSnippets.ts`: `applyForkSettingsPatch` merges the field.
- `apps/server/src/fork/reviewGroups/rpcHandlers.ts`: resolves
  `settings.fork.reviewGroupsModelSelection ?? settings.textGenerationModelSelection`.

Base files touched (additive — text generation is the only LLM seam, so the new
capability lives with its siblings):

- `apps/server/src/textGeneration/TextGeneration.ts`: new
  `generateSemanticDiffGroups` method on `TextGenerationShape` /
  `TextGenerationService`, its input/result types, the registry delegation, and
  the `TextGenerationOp` union entry.
- `apps/server/src/textGeneration/TextGenerationPrompts.ts`:
  `buildSemanticDiffGroupsPrompt` — agentic prompt that instructs the agent to
  gather the diff itself (per source `kind`); no patch text embedded.
- `apps/server/src/textGeneration/{Claude,Codex}TextGeneration.ts`: implement the
  agentic path, passing the diff scope (`kind`/`baseRef`/`headRef`) to the prompt.
- `apps/server/src/textGeneration/{Cursor,Grok,OpenCode}TextGeneration.ts`:
  `generateSemanticDiffGroups` fails fast with the shared "only supported for
  Claude and Codex" `TextGenerationError` (their ACP/deny-all modes can't run
  tools).
- `apps/server/src/vcs/GitVcsDriverCore.ts`: raises the three review-diff caps to
  a single high `REVIEW_DIFF_MAX_OUTPUT_BYTES` (5 MB) ceiling so the viewer
  renders large diffs in full; the truncation banner stays as a rare backstop.
- `apps/server/src/textGeneration/TextGeneration.test.ts`: stub default for the
  new method.
- `packages/contracts/src/rpc.ts`: one import + two spreads
  (`...FORK_REVIEW_GROUPS_WS_METHODS`, `...FORK_REVIEW_GROUPS_RPCS`).
- `packages/contracts/src/index.ts`: re-export `forkReviewGroups.ts`.
- `apps/server/src/ws.ts`: import `TextGeneration` + the fork handler seam,
  resolve `textGeneration`, spread `...FORK_REVIEW_GROUPS_REQUIRED_SCOPE` and
  `...makeForkReviewGroupsHandlers({ review, textGeneration, serverSettings }, …)`.
- `apps/web/src/fork/diffViewer/ReviewDiffViewer.tsx`: the header button +
  Files/Groups toggle, the grouping command + state, the error banner, the
  group-ordered diff pane, and the conditional sidebar.

## Merge Notes

- New RPC follows the fork-RPC convention established by Jira: contract bodies in
  `forkReviewGroups.ts`, handler bodies in `apps/server/src/fork/reviewGroups/`,
  spread into base `rpc.ts` and `ws.ts` at their existing fork append points. If
  upstream restructures `WS_METHODS` / `WsRpcGroup.make`, re-add the two spreads;
  if it restructures the `ws.ts` scope map / handler object, re-add
  `...FORK_REVIEW_GROUPS_REQUIRED_SCOPE` and `...makeForkReviewGroupsHandlers(...)`
  (the handler needs `review`, `textGeneration`, and `serverSettings` in scope).
- The text-generation edits are additive. If upstream adds another
  `TextGenerationShape` method or a new backend, mirror the
  `generateSemanticDiffGroups` shape (interface entry + registry delegation +
  one method per backend calling that backend's `run*Json`). The contract
  `TextGenerationError.operation` is a free string, so no new operation literal
  needs registering there.
- Grouping uses `fork.reviewGroupsModelSelection` when set, else the
  server-configured `textGenerationModelSelection`. The override is NOT run
  through `resolveTextGenerationProvider`, so if it points at a disabled/removed
  provider the RPC fails with a `TextGenerationError` (header error banner)
  rather than silently falling back — the UI picker resolves display against the
  live providers, but the persisted value is used as-is server-side.
- The viewer reuses the existing `review.getDiffPreview` diff. The client
  reconciles model file paths against the parsed diff, so a model that omits or
  misformats paths degrades gracefully (unknown paths dropped, leftovers land in
  "Other changes").

## Verification

- Required project checks: `vp check` and `vp run typecheck`. Note: `vp run
typecheck` caches aggressively — when validating changes that touch contract
  schemas or test files, run `npx tsgo --noEmit` directly in the affected
  package to bypass stale cache.
- Unit tests:
  - `packages/contracts/src/forkReviewGroups.test.ts` (schema encode/decode,
    guards the 0-100 risk bound).
  - `apps/server/src/fork/reviewGroups/reviewGroups.test.ts` (normalization).
  - `apps/web/src/fork/diffViewer/reviewDiffGroupsModel.test.ts` (reconciliation).
- Adding `generateSemanticDiffGroups` to `TextGenerationShape` also requires the
  `TextGeneration` mocks in `apps/server/src/server.test.ts` and
  `apps/server/src/git/GitManager.test.ts` to implement it (done).

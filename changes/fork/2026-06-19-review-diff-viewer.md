# Review Diff Viewer

Status: current fork-local change.

## Summary

- Adds a "Review" button to the chat workspace header that opens a full-screen
  diff viewer for the current working tree.
- The viewer shows a file tree (with A/D/M/R status markers) on the left and
  syntax-highlighted, per-file diffs on the right, plus an aggregate file count
  and +/- totals.
- Supports unified/split rendering, switching between the diff sources the
  server already exposes (working tree vs. branch range), per-file collapse, a
  local "mark reviewed" toggle, and keyboard navigation: `j`/`k` scroll, `n`/`p`
  next/prev file, `[`/`]` prev/next hunk, `v` toggle unified/split, `m` mark
  reviewed, `d` switch source, `Esc` close. The sidebar selection follows the
  scroll position so `m`/`v` act on the file currently in view.

## Why

The base app only surfaces diffs per agent turn inside the inline right panel.
This gives a dedicated, full-screen "review everything in the working tree"
surface similar to a TUI diff tool, without disturbing the base diff panel.

## Files

- `apps/web/src/fork/diffViewer/reviewDiffModel.ts` (+ `.test.ts`): pure helpers
  that map parsed `@pierre/diffs` `FileDiffMetadata` into a sorted file list,
  per-file add/remove counts, A/D/M/R status, and a nested directory tree.
- `apps/web/src/fork/diffViewer/reviewDiffStyles.ts`: fork-local copy of the
  diff CSS theming overrides (kept local instead of importing from the base
  `DiffPanel` to keep the feature decoupled).
- `apps/web/src/fork/diffViewer/ReviewDiffFileTree.tsx`: the left-hand file tree.
- `apps/web/src/fork/diffViewer/ReviewDiffViewer.tsx`: the full-screen overlay;
  fetches the working-tree diff via the existing `review.getDiffPreview` RPC
  (`reviewEnvironment.diffPreview`), renders each file with `@pierre/diffs`'
  `FileDiff`, and handles selection/keyboard/source switching.
- `apps/web/src/fork/diffViewer/ReviewDiffButton.tsx`: the toolbar button that
  lazily mounts the viewer.
- `apps/web/src/fork/chatHeaderActions.tsx`: `ForkChatHeaderActions` seam.
- `apps/web/src/components/chat/ChatHeader.tsx`: the single base-file edit — one
  import plus rendering `<ForkChatHeaderActions />` in the header action group.

## Merge Notes

- No server, contract, or settings changes were needed: the viewer reuses the
  existing `review.getDiffPreview` RPC and the already-wired
  `reviewEnvironment.diffPreview` client atom.
- The only base-file touchpoint is `ChatHeader.tsx`. If upstream restructures
  the header action group, re-add `<ForkChatHeaderActions environmentId cwd />`
  alongside the git controls.
- `reviewDiffStyles.ts` intentionally duplicates the base `DiffPanel` CSS
  overrides. If upstream changes the diff theming variables, mirror the change
  here (or switch to importing the base constant if it becomes exported).
- Rendering relies on the `DiffWorkerPoolProvider` that already wraps
  `ChatView`; the viewer must stay mounted within that subtree for syntax
  highlighting to work.
- The viewer root carries `data-slot="dialog"` so `ChatView`'s
  "type-to-focus-composer" capture handler (`TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR`)
  stops intercepting plain keystrokes while the viewer is open — otherwise its
  single-key shortcuts (`j`/`k`/`v`/`m`/`d`/`[`/`]`) get swallowed into the
  composer. If upstream changes that selector or the type-to-focus mechanism,
  keep an equivalent "a fork modal is open" marker on the viewer root.

## Verification

- Required project checks: `vp check` and `vp run typecheck`.
- Unit tests: `apps/web/src/fork/diffViewer/reviewDiffModel.test.ts`.

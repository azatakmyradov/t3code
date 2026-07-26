# Upstream maintenance for the subagents fork

The canonical repository is `https://github.com/pingdotgg/t3code.git`. The
recorded base for this feature stack is
`2d31cb022dee43e5a729273a6936228f30077e29`.

## One-time setup

```sh
git remote add upstream https://github.com/pingdotgg/t3code.git
git config rerere.enabled true
git config rerere.autoupdate true
```

If `upstream` already exists, verify it with `git remote -v` instead of adding
it again.

## Rebase workflow

```sh
git fetch upstream
git rebase upstream/main
```

Keep the fork as this ordered commit stack:

1. `fork(subagents): add isolated contracts and pure state`
2. `fork(subagents-server): add persistence, coordinator, and MCP toolkit`
3. `fork(integration): mount provider, shell-count, settle, and visibility adapters`
4. `fork(subagents-web): add agents right-panel surface`
5. `fork(subagents-mobile): add agents inspector`
6. `fork(tooling): enforce upstream integration surface`
7. A separate React/compiler compatibility commit, until upstreamed or removed

Resolve conflicts inside the fork-owned roots first. For upstream files, keep
upstream behavior intact and reapply only the narrow adapter described below.
Run `node scripts/fork-upstream-surface.ts` before continuing the rebase so an
accidental core-model or projection change is caught at the commit where it was
introduced. Git `rerere` will reuse recorded conflict resolutions on later
rebases; inspect every reused resolution before staging it.

## Ownership and adapter allowlist

Substantial feature logic belongs only under:

- `packages/fork-subagents/`
- `apps/server/src/features/subagents/`
- `apps/web/src/features/subagents/`
- `apps/mobile/src/features/subagents/`
- `docs/fork/`
- `scripts/fork-*`

The exact audited upstream integration allowlist is recorded in
`docs/fork/upstream-base.json` and consumed by
`scripts/fork-upstream-surface.ts`. It covers package wiring, the optional shell
count, provider role derivation, MCP registration, settle/wake behavior, client
shell filtering, awareness, and the small web/mobile mounts. Changes to any
other upstream-owned file fail the guard.

The staged experimental migration 034 is deliberately unsupported. Reset a
local development state database that recorded it before running this build.
Do not add destructive automatic cleanup or a legacy child-ID compatibility
path; normal T3 data is otherwise left untouched.

## Focused verification

```sh
node scripts/fork-upstream-surface.ts
vp test run packages/fork-subagents/src/*.test.ts
vp test run apps/server/src/features/subagents/*.test.ts
vp test run apps/server/src/features/subagents/mcp/*.test.ts
vp test run apps/server/src/orchestration/decider.settled.test.ts
vp test run packages/client-runtime/src/state/shellReducer.test.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/fork-subagents typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

Integrated web and mobile verification uses the repository’s `test-t3-app` and
`test-t3-mobile` workflows only when local development-server management has
been explicitly authorized.

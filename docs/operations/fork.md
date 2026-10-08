# Maintaining T3 Fork

`origin` is the private `azatakmyradov/t3code` repository. `upstream` is
`pingdotgg/t3code`. This is an independent private repository with upstream Git
history, rather than a member of GitHub's public fork network.

## Run and install

Use Node.js 24 and Vite+. From this checkout:

```sh
vp i
vp run dev
```

Development uses `~/.t3-fork/dev/userdata` in the main checkout and `.t3/userdata`
in a linked worktree. Read the actual ports from the dev runner's output.

For a standalone production server with the bundled web client:

```sh
vp run build:desktop
node apps/server/dist/bin.mjs
```

For a macOS Apple Silicon desktop installer:

```sh
vp run dist:desktop:dmg:arm64
```

Install the generated DMG manually. Signing and notarization require your own
Apple credentials; a local build without them is unsigned. The app's command
installation action installs `t3-fork`. The fork's npm package name is
`@azatakmyradov/t3-fork`; it is not available until you publish it.

The upstream installers, Homebrew cask, store links, and hosted web app install
or serve T3 Code. They do not distribute this private fork. Private GitHub
release downloads also need authentication; the archive installers and SSH
runtime downloads currently assume anonymously downloadable releases.

## Use both apps

T3 Fork defaults to `~/.t3-fork/userdata` and server port `4773`. Its Electron
profiles are `t3-fork` and `t3-fork-dev` under the OS application-data directory.
Its URL schemes, service names, CLI links, and Linux capture helpers have their
own identities. T3 Code keeps its existing installation and data.

Existing `T3CODE_HOME`, `T3CODE_PORT`, and explicit `--base-dir`/`--home-dir`
options still override defaults. Do not point either app at the other's live
data directory. Providers may still share their own CLI credentials; separate
T3 homes do not create separate provider accounts.

Desktop automatic updates are disabled unless a build explicitly supplies
`T3CODE_DESKTOP_UPDATE_REPOSITORY` or the mock updater option. Install new builds
manually for now. Mobile builds have independent IDs and require your own
signing/EAS configuration; OTA updates are disabled by default.

Inherited publishing and deployment workflows are disabled in the private
repository. CI remains available. Configure fork-owned credentials and targets
before enabling release automation; upstream release procedures describe the
original project's infrastructure.

## Keep up with upstream

Keep `main` as the working fork branch. Make changes on small feature branches
and merge them into `main`. Preserve upstream commit history with merges rather
than rebasing published fork commits. Sync weekly and sooner for a needed fix.
Start each sync with a clean working tree:

```sh
git switch main
git pull --ff-only origin main
git fetch upstream --prune --no-tags
git switch -c sync/upstream-YYYY-MM-DD
git merge upstream/main
```

Resolve conflicts on the sync branch. Recheck the fork's identity, default home,
ports, profiles, CLI and service names, mobile IDs, and manual-update defaults.
Run tests and package typechecks for the affected areas, then build the surface
you use. When the sync is ready:

```sh
git switch main
git merge --ff-only sync/upstream-YYYY-MM-DD
git push origin main
```

Git pushes default to `origin`. Do not force-push routine upstream syncs. If an
urgent upstream fix cannot wait for a full sync, cherry-pick it on a feature
branch and let the next merge reconcile its history. Keep fork changes focused
and reuse the shared fork identity constants when upstream adds an integration.

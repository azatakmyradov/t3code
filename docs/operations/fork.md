# Maintaining T3 Fork

`origin` is the public `azatakmyradov/t3code` repository. `upstream` is
`pingdotgg/t3code`. This is an independent repository with upstream Git
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
or serve T3 Code. They do not distribute this fork. Its public GitHub Releases host the fork
installers, update metadata, and CLI archives used by remote environments.

## Use both apps

T3 Fork defaults to `~/.t3-fork/userdata` and server port `4773`. Its Electron
profiles are `t3-fork` and `t3-fork-dev` under the OS application-data directory.
Its URL schemes, service names, CLI links, and Linux capture helpers have their
own identities. T3 Code keeps its existing installation and data.

Existing `T3CODE_HOME`, `T3CODE_PORT`, and explicit `--base-dir`/`--home-dir`
options still override defaults. Do not point either app at the other's live
data directory. Providers may still share their own CLI credentials; separate
T3 homes do not create separate provider accounts.

Desktop builds default to the `azatakmyradov/t3code` GitHub Releases update feed.
Install the first signed build manually. Later versions can be downloaded and
installed through the app's update button. `T3CODE_DESKTOP_UPDATE_REPOSITORY`
can select another repository; set it to `none` to package without an update feed.
Preview builds still have no feed. Mobile builds require your own signing/EAS
configuration; OTA updates are disabled by default.

Inherited release and deployment entry points remain disabled. The separate
**T3 Fork release** workflow uses GitHub-hosted runners and the existing desktop
packager through its reusable workflow to build macOS, Linux, and Windows for x64 and arm64. It publishes CLI
archives and checksums, plus architecture-specific desktop update metadata.
It does not deploy a website or relay or publish to npm.

After configuring the Apple credentials below, run **T3 Fork release** from the
Actions tab on `main`, or run:

```sh
gh workflow run fork-release.yml --repo azatakmyradov/t3code --ref main -f version=0.0.45
```

Choose a new, increasing stable version for each release. The workflow verifies
signing prerequisites before building and publishes only when all platforms
succeed. Windows signing is optional through the existing Azure secrets.
Keep the same Apple signing identity across macOS updates.

## Set up Apple signing

A paid Apple Developer membership lets you create the credentials. The release
workflow needs a Developer ID certificate and its private key, a profile for
this app's Associated Domains entitlement, and a team API key for notarization.

### Create and export the signing certificate

1. Open Keychain Access on your Mac. In its menu, choose **Certificate Assistant →
   Request a Certificate from a Certificate Authority**. Enter your email and a
   name such as `T3 Fork signing`, leave the CA email empty, and save the request
   to disk. [Apple's certificate-request guide](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request).
2. Open [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates/list).
   Add a **Developer ID Application** certificate and upload that request.
   Download the resulting `.cer` and double-click it on the same Mac to install
   it. [Apple's Developer ID guide](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
3. In Keychain Access, open **My Certificates**. Expand the Developer ID
   Application entry and verify that its private key appears beneath it.
   Export the signing identity as `T3Fork-signing.p12`. Choose and save an export
   password; this is the value for `CSC_KEY_PASSWORD`.
   [Apple's export guide](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac).
4. Copy the encoded certificate to the clipboard:

   ```sh
   base64 < ~/Downloads/T3Fork-signing.p12 | pbcopy
   ```

   Paste it into the GitHub Actions secret named `CSC_LINK`.

### Create the app profile

In [Apple Developer Identifiers](https://developer.apple.com/account/resources/identifiers/list),
register an explicit App ID with bundle ID `com.azatakmyradov.t3fork`, named
`T3 Fork`, and enable **Associated Domains**. Then open **Profiles**, add a
**Developer ID** distribution profile, and select that App ID and your Developer
ID Application certificate. Download the profile.

Copy its encoded contents to the clipboard, substituting its downloaded name:

```sh
base64 < ~/Downloads/T3Fork.provisionprofile | pbcopy
```

Paste into `MACOS_PROVISIONING_PROFILE`. The profile's team and app ID must match
the certificate and fork bundle ID. Passkey sign-in also requires the matching
website's association file and Clerk configuration; see
[desktop passkeys](connect-setup.md#desktop-passkeys). Signing alone does not
register the fork with the upstream website.

### Create the notarization key

Open [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api)
and go to **Users and Access → Integrations → App Store Connect API → Team Keys**.
Request API access first if the page asks. Generate a team key named
`T3 Fork releases` with permission to submit notarization requests. Download the
`.p8` file; Apple provides this download once. Use a team key for this workflow.
[Apple's team API-key guide](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/).

### Add the GitHub values

Open [Actions secrets](https://github.com/azatakmyradov/t3code/settings/secrets/actions)
and add each entry as a repository secret:

| Name                         | Value                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| `CSC_LINK`                   | Base64 contents of the `.p12` export                          |
| `CSC_KEY_PASSWORD`           | Password you chose when exporting the `.p12`                  |
| `MACOS_PROVISIONING_PROFILE` | Base64 contents of the Developer ID profile                   |
| `APPLE_API_KEY`              | Entire downloaded `.p8` text, including its header and footer |
| `APPLE_API_KEY_ID`           | Key ID shown beside the team key in App Store Connect         |
| `APPLE_API_ISSUER`           | Issuer ID shown on the team API-keys page                     |

Find your 10-character Team ID under **Membership details** in
[Apple Developer](https://developer.apple.com/account). Add `APPLE_TEAM_ID`
as a repository variable under
[Actions variables](https://github.com/azatakmyradov/t3code/settings/variables/actions).
The workflow consumes these values directly from GitHub. Keep the files and
passwords outside the repository and chat.

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

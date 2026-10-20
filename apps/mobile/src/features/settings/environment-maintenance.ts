import {
  AuthEnvironmentMaintainScope,
  sessionGrantsScope,
  type AuthSessionState,
  type ExecutionEnvironmentCapabilities,
  type ExecutionEnvironmentDescriptor,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  CLI_RELEASES_PAGE_URL,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import {
  canTargetServerRelease,
  MANUAL_RELEASE_CHECK_GUIDANCE,
} from "@t3tools/shared/releaseCompatibility";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

export function canMaintainEnvironment(session: AuthSessionState | null, connected: boolean) {
  return (
    connected &&
    session?.authenticated === true &&
    sessionGrantsScope(session, AuthEnvironmentMaintainScope)
  );
}

export function supportsEnvironmentUpdate(
  capabilities: Pick<ExecutionEnvironmentCapabilities, "serverSelfUpdate" | "desktopAppUpdate">,
) {
  return (
    capabilities.serverSelfUpdate !== undefined &&
    (capabilities.serverSelfUpdate !== "desktop-managed" || capabilities.desktopAppUpdate === true)
  );
}

/** The desktop app chooses its own feed; the installed version is only the RPC's nominal target. */
export function desktopEnvironmentUpdateTarget(
  environment:
    | Pick<ExecutionEnvironmentDescriptor, "serverVersion" | "release" | "capabilities">
    | null
    | undefined,
): string | null {
  return environment?.capabilities.serverSelfUpdate === "desktop-managed" &&
    supportsEnvironmentUpdate(environment.capabilities) &&
    canTargetServerRelease(environment, environment.serverVersion)
    ? environment.serverVersion
    : null;
}

export function canUpdateEnvironmentProvider(provider: ServerProvider) {
  const compatibility = provider.compatibilityAdvisory?.latestVersionStatus;
  return (
    provider.installed &&
    provider.availability !== "unavailable" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.canUpdate &&
    provider.versionAdvisory.latestVersion !== null &&
    compatibility !== "broken" &&
    compatibility !== "unsupported" &&
    provider.updateState?.status !== "running" &&
    provider.updateState?.status !== "queued"
  );
}

const Release = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
});
const decodeRelease = Schema.decodeUnknownSync(Release);
const decodeReleases = Schema.decodeUnknownSync(Schema.Array(Release));

async function fetchReleases(url: string, accept: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, headers: { Accept: accept } });
  if (!response.ok) throw new Error(`Could not check releases (${response.status}). Try again.`);
  return response;
}

/** Preserve the host's release channel and never offer a downgrade. */
export async function findEnvironmentUpdate(
  environment: Pick<ExecutionEnvironmentDescriptor, "serverVersion" | "release"> &
    Partial<Pick<ExecutionEnvironmentDescriptor, "capabilities">>,
  signal: AbortSignal,
) {
  if (environment.capabilities?.serverSelfUpdate === "desktop-managed") {
    throw new Error("Check for updates using the desktop app's own update feed.");
  }
  const currentVersion = environment.serverVersion;
  const channel = environment.release?.channel;
  if (
    !canTargetServerRelease(environment, currentVersion) ||
    (channel !== "stable" && channel !== "nightly")
  ) {
    throw new Error(MANUAL_RELEASE_CHECK_GUIDANCE);
  }
  // Public release pages avoid the anonymous API quota shared by devices on the same network.
  const response = await fetchReleases(
    channel === "stable" ? `${CLI_RELEASES_PAGE_URL}/latest` : `${CLI_RELEASES_PAGE_URL}.atom`,
    channel === "stable" ? "application/json" : "application/atom+xml",
    signal,
  );
  const releases =
    channel === "stable"
      ? [decodeRelease(await response.json())]
      : Array.from(
          (await response.text()).matchAll(
            /<id>tag:github\.com,2008:Repository\/\d+\/([^<]+)<\/id>/g,
          ),
          ([, tag_name = ""]) => ({ tag_name }),
        );
  let version = newestCliReleaseVersion(releases, channel);

  // The feed only includes ten releases, so later nightlies can displace a published preview.
  for (let page = 1; version === undefined; page++) {
    const response = await fetchReleases(
      cliReleaseIndexPageUrl(page),
      "application/vnd.github+json",
      signal,
    );
    const releases = decodeReleases(await response.json());
    version = newestCliReleaseVersion(releases, channel);
    if (releases.length < 100) break;
  }

  if (version === undefined) throw new Error(`No ${channel} release was found.`);
  return compareSemverVersions(version, currentVersion) > 0 ? version : null;
}

import {
  AuthEnvironmentMaintainScope,
  sessionGrantsScope,
  type AuthSessionState,
  type ExecutionEnvironmentCapabilities,
  type ExecutionEnvironmentDescriptor,
  type ServerProvider,
} from "@t3tools/contracts";
import { cliReleaseIndexPageUrl, newestCliReleaseVersion } from "@t3tools/shared/cliRelease";
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

const Releases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optionalKey(Schema.Boolean),
  }),
);
const decodeReleases = Schema.decodeUnknownSync(Releases);

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
  for (let page = 1; ; page++) {
    const response = await fetch(cliReleaseIndexPageUrl(page), { signal });
    if (!response.ok) throw new Error(`Could not check releases (${response.status}). Try again.`);
    const releases = decodeReleases(await response.json());
    const version = newestCliReleaseVersion(releases, channel);
    if (version !== undefined) {
      return compareSemverVersions(version, currentVersion) > 0 ? version : null;
    }
    if (releases.length < 100) throw new Error(`No ${channel} release was found.`);
  }
}

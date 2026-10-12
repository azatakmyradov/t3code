import type { ExecutionEnvironmentDescriptor, ServerRelease } from "@t3tools/contracts";

import { FORK_REPOSITORY } from "./forkIdentity.ts";

/** Only this build's identity is known locally. Never apply it to a remote version string. */
export function forkReleaseForVersion(version: string): ServerRelease {
  const recognized = /^\d+\.\d+\.\d+(?:-(nightly|preview)\.\d{8}\.\d+)?$/.exec(version);
  const channel = recognized?.[1];
  return {
    distribution: FORK_REPOSITORY,
    channel:
      recognized === null
        ? "unknown"
        : channel === "nightly" || channel === "preview"
          ? channel
          : "stable",
  };
}

/** A client version is an update target only within the host's proven release train. */
export function canTargetServerRelease(
  environment: Pick<ExecutionEnvironmentDescriptor, "release"> | null | undefined,
  targetVersion: string,
): boolean {
  const target = forkReleaseForVersion(targetVersion);
  const release = environment?.release;
  return (
    release !== undefined &&
    release.distribution === target.distribution &&
    release.channel === target.channel &&
    (target.channel === "stable" || target.channel === "nightly")
  );
}

export const MANUAL_RELEASE_CHECK_GUIDANCE =
  "Check for updates on the server's own installation. This client cannot choose a compatible release for it.";

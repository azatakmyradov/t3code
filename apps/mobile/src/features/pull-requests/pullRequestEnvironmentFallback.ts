import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { PullRequestParams } from "./pullRequestTarget";

export type PullRequestEnvironmentTarget = Pick<
  PullRequestParams,
  "environmentId" | "projectId" | "repository" | "host" | "expectedAccountId" | "initialSummary"
>;

export function pullRequestFallbackEnvironment(
  target: PullRequestEnvironmentTarget,
  projects: ReadonlyArray<EnvironmentProject>,
  connectedEnvironmentIds: ReadonlySet<string>,
) {
  if (
    target.expectedAccountId !== undefined ||
    target.initialSummary !== undefined ||
    connectedEnvironmentIds.has(target.environmentId)
  )
    return null;
  const own = projects.find(
    (project) => project.environmentId === target.environmentId && project.id === target.projectId,
  );
  const host = target.host ?? own?.repositoryIdentity?.canonicalKey.split("/")[0];
  if (!host) return null;
  const key = `${host}/${target.repository}`.toLowerCase();
  const copy = projects.find(
    (project) =>
      project.environmentId !== target.environmentId &&
      connectedEnvironmentIds.has(project.environmentId) &&
      project.repositoryIdentity?.canonicalKey.toLowerCase() === key,
  );
  return copy ? { environmentId: String(copy.environmentId), projectId: String(copy.id) } : null;
}

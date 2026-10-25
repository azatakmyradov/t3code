import {
  resolveChangeRequestLinkTarget,
  type ChangeRequestLinkCapabilities,
} from "@t3tools/client-runtime/change-request-links";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

export type PullRequestNavigationContext = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly host?: string;
  readonly expectedAccountId?: string;
};

/** The PullRequest route for a change request link from a project, or null for the browser. */
export function nativePullRequestDestination(
  url: string,
  context: PullRequestNavigationContext | null,
  projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "repositoryIdentity">>,
  capabilities: (environmentId: EnvironmentId) => ChangeRequestLinkCapabilities | undefined,
) {
  if (!context) return null;
  const target = resolveChangeRequestLinkTarget({
    url,
    projects,
    capabilities,
    environmentId: EnvironmentId.make(context.environmentId),
    projectId: ProjectId.make(context.projectId),
    lendHostProject: true,
  });
  if (target === null) return null;
  return {
    environmentId: context.environmentId,
    projectId: String(target.project.id),
    ...(context.expectedAccountId && context.host?.toLowerCase() === target.host?.toLowerCase()
      ? { expectedAccountId: context.expectedAccountId }
      : {}),
    repository: target.repository,
    number: target.number,
    ...(target.host === undefined ? {} : { host: target.host }),
  };
}

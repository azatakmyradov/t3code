import { parsePullRequestAnchor } from "@t3tools/shared/pullRequestAnchor";
import { resolveChangeRequestLinkTarget } from "@t3tools/client-runtime/change-request-links";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, type IssueRef } from "@t3tools/contracts";

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
  configLoaded: (environmentId: EnvironmentId) => boolean,
) {
  if (!context) return null;
  const target = resolveChangeRequestLinkTarget({
    url,
    projects,
    configLoaded,
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
    ...(parsePullRequestAnchor(url) ? { navigationUrl: url } : {}),
    ...(target.host === undefined ? {} : { host: target.host }),
  };
}

/**
 * The pull request an issue link may name instead, on a host that numbers both in one sequence
 * and writes every `#12` through its issue route. Null elsewhere. Only a candidate to read.
 */
export function pullRequestCandidateForIssueLink(
  url: string,
  ref: Pick<IssueRef, "projectId" | "host" | "scope" | "key">,
) {
  const candidateUrl = sourceControlClients.changeRequestUrlFromReferenceAutolink(url);
  const number = Number(ref.key);
  if (candidateUrl === null || !Number.isInteger(number) || number <= 0) return null;
  return {
    target: {
      projectId: ref.projectId,
      ...(ref.host === undefined ? {} : { host: ref.host }),
      repository: ref.scope,
      number,
    },
    navigationUrl: parsePullRequestAnchor(candidateUrl) ? candidateUrl : undefined,
  };
}

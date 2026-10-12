import { EnvironmentId, ProjectId, type PullRequestListEntry } from "@t3tools/contracts";
import type { EnvironmentPullRequestListEntry } from "./pullRequestList";

export type PullRequestParams = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly repository: string;
  readonly number: number;
  readonly host?: string;
  readonly expectedAccountId?: string;
  readonly initialSummary?: PullRequestListEntry;
};

/** Preserve the selected workspace and account through every detail read and action. */
export function pullRequestTarget(params: PullRequestParams) {
  return {
    environmentId: EnvironmentId.make(params.environmentId),
    input: {
      projectId: ProjectId.make(params.projectId),
      repository: params.repository,
      number: params.number,
      ...(params.host ? { host: params.host } : {}),
      ...(params.expectedAccountId ? { expectedAccountId: params.expectedAccountId } : {}),
    },
  };
}

/** List navigation and quick actions share the exact account and workspace that read the row. */
export function pullRequestListParams(entry: EnvironmentPullRequestListEntry): PullRequestParams {
  return {
    environmentId: entry.environmentId,
    projectId: entry.projectId,
    host: entry.host,
    repository: entry.repository,
    number: entry.number,
    ...(entry.expectedAccountId ? { expectedAccountId: entry.expectedAccountId } : {}),
    initialSummary: entry,
  };
}

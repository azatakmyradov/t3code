import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";

export type PullRequestNavigationContext = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly host?: string;
  readonly expectedAccountId?: string;
};

export function nativePullRequestDestination(
  url: string,
  context: PullRequestNavigationContext | null,
) {
  const parsed = parseChangeRequestUrl(url);
  if (!parsed || !context) return null;
  const host = parsed.authority ?? parsed.host;
  return {
    environmentId: context.environmentId,
    projectId: context.projectId,
    ...(context.expectedAccountId && context.host?.toLowerCase() === host.toLowerCase()
      ? { expectedAccountId: context.expectedAccountId }
      : {}),
    repository: parsed.repository,
    number: parsed.number,
    host,
  };
}

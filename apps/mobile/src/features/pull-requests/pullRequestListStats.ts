import type { PullRequestDiffStat, PullRequestRef } from "@t3tools/contracts";
import { pullRequestListKey, type EnvironmentPullRequestListEntry } from "./pullRequestList";

export type PullRequestListStatRow = Pick<
  EnvironmentPullRequestListEntry,
  "environmentId" | "projectId" | "host" | "repository" | "number" | "viewer" | "expectedAccountId"
>;

export function pullRequestListStatRow(
  row: EnvironmentPullRequestListEntry,
): PullRequestListStatRow {
  const { environmentId, projectId, host, repository, number, viewer, expectedAccountId } = row;
  return { environmentId, projectId, host, repository, number, viewer, expectedAccountId };
}

/** The viewer can change while the workspace and PR stay the same. */
export const pullRequestListStatKey = (row: PullRequestListStatRow) =>
  JSON.stringify([row.environmentId, pullRequestListKey(row), row.viewer?.toLowerCase() ?? ""]);

export function pullRequestListStatRef(row: PullRequestListStatRow): PullRequestRef {
  return {
    projectId: row.projectId,
    host: row.host,
    repository: row.repository,
    number: row.number,
    ...(row.expectedAccountId ? { expectedAccountId: row.expectedAccountId } : {}),
  };
}

/** Legacy wire results omit host/account fields; only an unambiguous row owns those counts. */
export function mergePullRequestListStats(
  previous: ReadonlyMap<string, PullRequestDiffStat>,
  rows: readonly PullRequestListStatRow[],
  stats: readonly PullRequestDiffStat[],
): ReadonlyMap<string, PullRequestDiffStat> {
  const next = new Map(previous);
  for (const stat of stats) {
    const matches = rows.filter(
      (row) =>
        row.projectId === stat.projectId &&
        row.repository.toLowerCase() === stat.repository.toLowerCase() &&
        row.number === stat.number &&
        (stat.host === undefined || row.host.toLowerCase() === stat.host.toLowerCase()) &&
        (stat.expectedAccountId === undefined ||
          row.expectedAccountId === undefined ||
          row.expectedAccountId === stat.expectedAccountId),
    );
    const keys = new Set(matches.map(pullRequestListStatKey));
    const key = keys.values().next().value;
    if (keys.size === 1 && key !== undefined) next.set(key, stat);
  }
  return next;
}

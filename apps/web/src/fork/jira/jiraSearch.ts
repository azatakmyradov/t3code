import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";
import type { JiraIssueSummary } from "@t3tools/contracts";

function scoreJiraIssue(issue: JiraIssueSummary, query: string): number | null {
  const key = issue.key.toLowerCase();
  const summary = issue.summary.toLowerCase();
  const scores = [
    scoreQueryMatch({
      value: key,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-"],
    }),
    scoreQueryMatch({
      value: summary,
      query,
      exactBase: 30,
      prefixBase: 32,
      boundaryBase: 34,
      includesBase: 36,
      fuzzyBase: 130,
    }),
  ].filter((score): score is number => score !== null);

  return scores.length > 0 ? Math.min(...scores) : null;
}

export function rankJiraIssues(
  issues: ReadonlyArray<JiraIssueSummary>,
  query: string,
): JiraIssueSummary[] {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^#+/u });
  if (!normalizedQuery) {
    return [...issues];
  }

  const ranked: Array<{ item: JiraIssueSummary; score: number; tieBreaker: string }> = [];
  issues.forEach((issue, index) => {
    const score = scoreJiraIssue(issue, normalizedQuery);
    if (score === null) return;
    insertRankedSearchResult(
      ranked,
      { item: issue, score, tieBreaker: String(index).padStart(6, "0") },
      Number.POSITIVE_INFINITY,
    );
  });
  return ranked.map((entry) => entry.item);
}

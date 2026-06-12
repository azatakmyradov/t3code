import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

import type { ComposerCommandItem } from "./ComposerCommandMenu";

type SnippetCommandItem = Extract<ComposerCommandItem, { type: "snippet" }>;

export function formatSnippetDescriptionPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function scoreSnippetItem(item: SnippetCommandItem, query: string): number | null {
  const keyword = item.keyword.toLowerCase();
  const description = formatSnippetDescriptionPreview(item.value).toLowerCase();
  const scores = [
    scoreQueryMatch({
      value: keyword,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_"],
    }),
    scoreQueryMatch({
      value: description,
      query,
      exactBase: 30,
      prefixBase: 32,
      boundaryBase: 34,
      includesBase: 36,
      fuzzyBase: 130,
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

export function searchSnippetItems(
  items: ReadonlyArray<SnippetCommandItem>,
  query: string,
): SnippetCommandItem[] {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^:+/ });
  if (!normalizedQuery) {
    return [...items];
  }

  const ranked: Array<{
    item: SnippetCommandItem;
    score: number;
    tieBreaker: string;
  }> = [];

  items.forEach((item, index) => {
    const score = scoreSnippetItem(item, normalizedQuery);
    if (score === null) {
      return;
    }

    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker: String(index).padStart(6, "0"),
      },
      Number.POSITIVE_INFINITY,
    );
  });

  return ranked.map((entry) => entry.item);
}

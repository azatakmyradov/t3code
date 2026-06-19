import { describe, expect, it } from "vite-plus/test";

import type { ForkComposerMenuItem } from "../composerExtensions";
import { searchSnippetItems } from "./snippetSearch";

type SnippetItem = Extract<ForkComposerMenuItem, { type: "fork-snippet" }>;

function snippet(keyword: string, value: string): SnippetItem {
  return {
    id: `snippet:${keyword}`,
    type: "fork-snippet",
    keyword,
    value,
    label: `:${keyword}`,
    description: value.replace(/\s+/g, " ").trim(),
  };
}

describe("searchSnippetItems", () => {
  it("preserves stored order for an empty query", () => {
    const items = [
      snippet("third", "Third value"),
      snippet("first", "First value"),
      snippet("second", "Second value"),
    ];

    expect(searchSnippetItems(items, "").map((item) => item.keyword)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("ranks prefix keyword matches above value matches", () => {
    const items = [snippet("triage", "Write a bug report"), snippet("bug", "Triage this issue")];

    expect(searchSnippetItems(items, "tri").map((item) => item.keyword)).toEqual(["triage", "bug"]);
  });

  it("searches descriptions case-insensitively", () => {
    const items = [snippet("bug", "Fix production issue")];

    expect(searchSnippetItems(items, "PRODUCTION").map((item) => item.keyword)).toEqual(["bug"]);
  });

  it("normalizes leading colons from queries", () => {
    const items = [snippet("bug", "Fix production issue")];

    expect(searchSnippetItems(items, "::BUG").map((item) => item.keyword)).toEqual(["bug"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchSnippetItems([snippet("bug", "Fix production issue")], "release")).toEqual([]);
  });
});

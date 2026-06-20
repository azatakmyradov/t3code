import { describe, expect, it } from "vite-plus/test";

import { parseJiraReferences } from "./JiraReferenceParser.ts";

const configuredSiteUrl = "https://example.atlassian.net";

function parse(text: string) {
  return parseJiraReferences({
    text,
    configuredSiteUrl,
    jiraConfigured: true,
  });
}

describe("parseJiraReferences", () => {
  it("extracts naked Jira keys", () => {
    expect(parse("Please look at ABC-123 and DEF2-456.").references).toEqual([
      { key: "ABC-123" },
      { key: "DEF2-456" },
    ]);
  });

  it("extracts configured-site Jira URLs", () => {
    expect(
      parse("See https://example.atlassian.net/browse/ABC-123 for details.").references,
    ).toEqual([
      {
        key: "ABC-123",
        url: "https://example.atlassian.net/browse/ABC-123",
      },
    ]);
  });

  it("extracts markdown Jira links", () => {
    expect(
      parse("See [ABC-123](https://example.atlassian.net/browse/ABC-123).").references,
    ).toEqual([
      {
        key: "ABC-123",
        url: "https://example.atlassian.net/browse/ABC-123",
      },
    ]);
  });

  it("deduplicates by uppercase key and preserves first-seen order", () => {
    expect(
      parse("Start DEF-2 then ABC-1 then https://example.atlassian.net/browse/DEF-2 and ABC-1.")
        .references,
    ).toEqual([{ key: "DEF-2" }, { key: "ABC-1" }]);
  });

  it("ignores naked keys inside inline and fenced code", () => {
    expect(
      parse(
        [
          "Fetch ABC-1.",
          "`DEF-2` should not count.",
          "```ts",
          "const key = 'GHI-3';",
          "```",
          "Use JKL-4 too.",
        ].join("\n"),
      ).references,
    ).toEqual([{ key: "ABC-1" }, { key: "JKL-4" }]);
  });

  it("rejects mismatched Jira URL hosts", () => {
    const result = parse("See https://other.atlassian.net/browse/ABC-123.");

    expect(result.references).toEqual([]);
    expect(result.failures).toEqual([
      {
        key: "ABC-123",
        url: "https://other.atlassian.net/browse/ABC-123",
        reason: "site_mismatch",
        message:
          "Jira URL host other.atlassian.net does not match configured Jira site example.atlassian.net.",
      },
    ]);
  });

  it("limits fetchable keys to five and records omitted keys", () => {
    const result = parse("ABC-1 DEF-2 GHI-3 JKL-4 MNO-5 PQR-6 STU-7");

    expect(result.references.map((reference) => reference.key)).toEqual([
      "ABC-1",
      "DEF-2",
      "GHI-3",
      "JKL-4",
      "MNO-5",
    ]);
    expect(result.omittedKeys).toEqual(["PQR-6", "STU-7"]);
  });

  it("ignores naked keys when Jira is not configured but keeps URL failures", () => {
    const result = parseJiraReferences({
      text: "ABC-123 and https://example.atlassian.net/browse/DEF-456",
      configuredSiteUrl: null,
      jiraConfigured: false,
    });

    expect(result.references).toEqual([]);
    expect(result.failures).toEqual([
      {
        key: "DEF-456",
        url: "https://example.atlassian.net/browse/DEF-456",
        reason: "not_configured",
        message: "Jira is not configured.",
      },
    ]);
  });
});

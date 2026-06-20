import { JiraIssueKey, type JiraIssueSummary } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyJiraComposerMenuItem,
  formatJiraIssueMarkdownLink,
  mergeJiraComposerIssues,
  toJiraComposerMenuItems,
  toRankedJiraComposerMenuItems,
} from "./jiraComposer";

function issue(key: string, summary: string): JiraIssueSummary {
  return {
    id: key,
    key: JiraIssueKey.make(key),
    summary,
    status: { name: "To Do", category: null },
    assignee: null,
    priority: null,
    priorityId: null,
    type: "Task",
    project: "Platform",
    projectTypeKey: null,
    updated: "2026-01-02T03:04:05.000+0000",
    url: `https://example.atlassian.net/browse/${key}`,
  };
}

describe("jiraComposer", () => {
  it("formats Jira issues as transparent markdown links", () => {
    expect(formatJiraIssueMarkdownLink(issue("ABC-123", "Fix deploy"))).toBe(
      "[ABC-123](https://example.atlassian.net/browse/ABC-123) ",
    );
  });

  it("converts Jira issues into composer menu items", () => {
    const items = toJiraComposerMenuItems([issue("ABC-123", "Fix deploy")]);

    expect(items).toEqual([
      {
        id: "jira-issue:ABC-123",
        type: "jira-issue",
        issue: issue("ABC-123", "Fix deploy"),
        url: "https://example.atlassian.net/browse/ABC-123",
        label: "ABC-123",
        description: "Fix deploy",
      },
    ]);
  });

  it("fuzzy-ranks Jira composer issues from the locally fetched list", () => {
    const issues = [
      issue("X3-546", "Where are we with Allied SEI?"),
      issue("REB-4", "Implement X3 License Tool"),
      issue("X3-571", "Lewis Bakery"),
    ];

    expect(toRankedJiraComposerMenuItems(issues, "REB").map((item) => item.label)).toEqual([
      "REB-4",
    ]);
    expect(toRankedJiraComposerMenuItems(issues, "REB-4").map((item) => item.label)).toEqual([
      "REB-4",
    ]);
  });

  it("merges remote picker and local fuzzy results without duplicate issues", () => {
    const reb = issue("REB-4", "Implement X3 License Tool");

    expect(
      mergeJiraComposerIssues([reb, issue("ABC-2", "Remote")], [issue("ABC-2", "Local"), reb]).map(
        (candidate) => [candidate.key, candidate.summary],
      ),
    ).toEqual([
      [JiraIssueKey.make("REB-4"), "Implement X3 License Tool"],
      [JiraIssueKey.make("ABC-2"), "Remote"],
    ]);
  });

  it("inserts Jira markdown links over the active # trigger range", () => {
    const item = toJiraComposerMenuItems([issue("ABC-123", "Fix deploy")])[0]!;
    const applyPromptReplacement = vi.fn(() => true);

    expect(
      applyJiraComposerMenuItem({
        item,
        trigger: { kind: "jira-issue", query: "ABC", rangeStart: 7, rangeEnd: 11 },
        applyPromptReplacement,
      }),
    ).toBe(true);
    expect(applyPromptReplacement).toHaveBeenCalledWith(
      7,
      11,
      "[ABC-123](https://example.atlassian.net/browse/ABC-123) ",
    );
  });
});

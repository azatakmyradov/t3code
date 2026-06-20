import { JiraIssueKey, type JiraIssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rankJiraIssues } from "./jiraSearch";

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
    project: key.split("-")[0] ?? "Jira",
    projectTypeKey: null,
    updated: "2026-01-02T03:04:05.000+0000",
    url: `https://example.atlassian.net/browse/${key}`,
  };
}

describe("rankJiraIssues", () => {
  it("preserves order for empty queries", () => {
    const issues = [issue("ABC-2", "Second"), issue("ABC-1", "First")];

    expect(rankJiraIssues(issues, "")).toEqual(issues);
  });

  it("ranks key matches above summary matches", () => {
    const issues = [
      issue("OPS-5", "Fix ABC deployment"),
      issue("ABC-123", "Unrelated summary"),
      issue("DESIGN-1", "Mockups"),
    ];

    expect(rankJiraIssues(issues, "#abc").map((candidate) => candidate.key)).toEqual([
      JiraIssueKey.make("ABC-123"),
      JiraIssueKey.make("OPS-5"),
    ]);
  });

  it("matches project key prefixes in issue keys", () => {
    const issues = [issue("X3-569", "Refresh PILOT"), issue("REB-54", "Receiving - Add COE")];

    expect(rankJiraIssues(issues, "REB").map((candidate) => candidate.key)).toEqual([
      JiraIssueKey.make("REB-54"),
    ]);
  });

  it("matches full issue keys and fuzzy keys without punctuation", () => {
    const issues = [issue("REB-4", "Implement X3 License Tool"), issue("X3-546", "Allied SEI")];

    expect(rankJiraIssues(issues, "REB-4").map((candidate) => candidate.key)).toEqual([
      JiraIssueKey.make("REB-4"),
    ]);
    expect(rankJiraIssues(issues, "reb4").map((candidate) => candidate.key)).toEqual([
      JiraIssueKey.make("REB-4"),
    ]);
  });

  it("searches summaries case-insensitively", () => {
    const issues = [issue("OPS-5", "Fix Production Deployment")];

    expect(rankJiraIssues(issues, "production").map((candidate) => candidate.key)).toEqual([
      JiraIssueKey.make("OPS-5"),
    ]);
  });
});

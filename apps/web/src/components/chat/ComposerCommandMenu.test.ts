import { JiraIssueKey } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupCommandItems, type ComposerCommandItem } from "./composerCommandMenuGrouping";

const fileItem: ComposerCommandItem = {
  id: "path:src/app.ts",
  type: "path",
  path: "src/app.ts",
  pathKind: "file",
  label: "src/app.ts",
  description: "src/app.ts",
};

const jiraItem: ComposerCommandItem = {
  id: "jira-issue:ABC-123",
  type: "jira-issue",
  label: "ABC-123",
  description: "Fix deploy",
  url: "https://example.atlassian.net/browse/ABC-123",
  issue: {
    id: "ABC-123",
    key: JiraIssueKey.make("ABC-123"),
    summary: "Fix deploy",
    status: { name: "To Do", category: null },
    assignee: null,
    priority: null,
    priorityId: null,
    type: "Task",
    project: "Platform",
    projectTypeKey: null,
    updated: "2026-01-02T03:04:05.000+0000",
    url: "https://example.atlassian.net/browse/ABC-123",
  },
};

describe("ComposerCommandMenu grouping", () => {
  it("groups # trigger results into the Jira section", () => {
    const groups = groupCommandItems([jiraItem], "jira-issue", true);

    expect(groups.map((group) => group.label)).toEqual(["Jira"]);
    expect(groups[0]?.items).toEqual([jiraItem]);
  });

  it("keeps file-only @ trigger results in the Files section", () => {
    const groups = groupCommandItems([fileItem], "path", true);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Files");
  });
});

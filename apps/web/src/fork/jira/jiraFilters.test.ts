import { DEFAULT_JIRA_PAGE_FILTERS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildJiraPageFilterJql } from "./jiraFilters";

describe("buildJiraPageFilterJql", () => {
  it("matches the legacy default assigned unresolved issue filter", () => {
    expect(buildJiraPageFilterJql(DEFAULT_JIRA_PAGE_FILTERS)).toBe(
      "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    );
  });

  it("builds a JQL query from Jira page filters", () => {
    expect(
      buildJiraPageFilterJql({
        space: "REBELSCAN",
        status: "inProgress",
        assignee: "unassigned",
        updated: "7d",
        sort: "createdDesc",
      }),
    ).toBe(
      'assignee is EMPTY AND statusCategory = "In Progress" AND updated >= -7d ORDER BY created DESC',
    );
  });

  it("uses a broad clause when filters are otherwise empty", () => {
    expect(
      buildJiraPageFilterJql({
        space: "",
        status: "all",
        assignee: "any",
        updated: "any",
        sort: "updatedAsc",
      }),
    ).toBe('created >= "1970-01-01" ORDER BY updated ASC');
  });

  it("does not include local Search work in server JQL", () => {
    expect(
      buildJiraPageFilterJql({
        space: "",
        status: "all",
        assignee: "any",
        updated: "any",
        sort: "updatedDesc",
      }),
    ).toBe('created >= "1970-01-01" ORDER BY updated DESC');
  });
});

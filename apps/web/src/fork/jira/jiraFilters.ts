import type { JiraPageFilters } from "@t3tools/contracts";

const STATUS_JQL: Record<JiraPageFilters["status"], string | null> = {
  all: null,
  done: "statusCategory = Done",
  inProgress: 'statusCategory = "In Progress"',
  todo: 'statusCategory = "To Do"',
  unresolved: "resolution = Unresolved",
};

const ASSIGNEE_JQL: Record<JiraPageFilters["assignee"], string | null> = {
  any: null,
  currentUser: "assignee = currentUser()",
  unassigned: "assignee is EMPTY",
};

const UPDATED_JQL: Record<JiraPageFilters["updated"], string | null> = {
  any: null,
  "7d": "updated >= -7d",
  "30d": "updated >= -30d",
};

const SORT_JQL: Record<JiraPageFilters["sort"], string> = {
  createdDesc: "created DESC",
  updatedAsc: "updated ASC",
  updatedDesc: "updated DESC",
};

export function buildJiraPageFilterJql(filters: JiraPageFilters): string {
  const clauses = [
    ASSIGNEE_JQL[filters.assignee],
    STATUS_JQL[filters.status],
    UPDATED_JQL[filters.updated],
  ].filter((clause): clause is string => clause !== null);

  const where = clauses.length > 0 ? clauses.join(" AND ") : 'created >= "1970-01-01"';
  return `${where} ORDER BY ${SORT_JQL[filters.sort]}`;
}

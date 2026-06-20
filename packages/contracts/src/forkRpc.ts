import { FORK_JIRA_RPCS, FORK_JIRA_WS_METHODS } from "./forkJira.ts";
import { FORK_REVIEW_GROUPS_RPCS, FORK_REVIEW_GROUPS_WS_METHODS } from "./forkReviewGroups.ts";

export const FORK_WS_METHODS = {
  ...FORK_JIRA_WS_METHODS,
  ...FORK_REVIEW_GROUPS_WS_METHODS,
} as const;

export const FORK_RPCS = [...FORK_JIRA_RPCS, ...FORK_REVIEW_GROUPS_RPCS] as const;

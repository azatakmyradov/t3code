import type { EnvironmentId, JiraIssueSummary, ServerSettings } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";

import type { ComposerTrigger } from "../../composer-logic";
import {
  JIRA_ISSUE_MENTION_DISPLAY_LIMIT,
  JIRA_ISSUE_MENTION_FETCH_LIMIT,
  rankJiraIssues,
} from "./jiraSearch";
import { JIRA_ALL_ISSUES_JQL, useJiraMentionSearch } from "./jiraState";

export type JiraComposerMenuItem = {
  readonly id: string;
  readonly type: "jira-issue";
  readonly issue: JiraIssueSummary;
  readonly url: string;
  readonly label: string;
  readonly description: string;
};

export function formatJiraIssueMarkdownLink(issue: JiraIssueSummary): string {
  return `[${issue.key}](${issue.url}) `;
}

export function toJiraComposerMenuItems(
  issues: ReadonlyArray<JiraIssueSummary>,
): JiraComposerMenuItem[] {
  return issues.map((issue) => ({
    id: `jira-issue:${issue.key}`,
    type: "jira-issue" as const,
    issue,
    url: issue.url,
    label: issue.key,
    description: issue.summary,
  }));
}

export function toRankedJiraComposerMenuItems(
  issues: ReadonlyArray<JiraIssueSummary>,
  query: string,
): JiraComposerMenuItem[] {
  return toJiraComposerMenuItems(
    rankJiraIssues(issues, query).slice(0, JIRA_ISSUE_MENTION_DISPLAY_LIMIT),
  );
}

export function mergeJiraComposerIssues(
  primary: ReadonlyArray<JiraIssueSummary>,
  fallback: ReadonlyArray<JiraIssueSummary>,
): JiraIssueSummary[] {
  const issuesByKey = new Map<string, JiraIssueSummary>();
  for (const issue of primary) {
    issuesByKey.set(issue.key, issue);
  }
  for (const issue of fallback) {
    if (!issuesByKey.has(issue.key)) issuesByKey.set(issue.key, issue);
  }
  return [...issuesByKey.values()];
}

export function applyJiraComposerMenuItem(input: {
  readonly item: JiraComposerMenuItem;
  readonly trigger: ComposerTrigger;
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
  ) => boolean;
}): boolean {
  return input.applyPromptReplacement(
    input.trigger.rangeStart,
    input.trigger.rangeEnd,
    formatJiraIssueMarkdownLink(input.item.issue),
  );
}

export function renderJiraComposerMenuIcon() {
  return <ListTodoIcon className="size-4 shrink-0 text-muted-foreground/80" />;
}

export function useJiraComposerItems(input: {
  readonly environmentId: EnvironmentId | null;
  readonly trigger: ComposerTrigger | null;
  readonly settings: ServerSettings;
}): {
  readonly items: JiraComposerMenuItem[];
  readonly isPending: boolean;
} {
  const triggerQuery = input.trigger?.kind === "jira-issue" ? input.trigger.query : null;
  const broadSearch = useJiraMentionSearch({
    environmentId: input.environmentId,
    settings: input.settings,
    query: triggerQuery === null ? null : "",
    jql: JIRA_ALL_ISSUES_JQL,
    limit: JIRA_ISSUE_MENTION_FETCH_LIMIT,
  });
  const remoteSearch = useJiraMentionSearch({
    environmentId: input.environmentId,
    settings: input.settings,
    query: triggerQuery?.trim() ? triggerQuery : null,
    jql: JIRA_ALL_ISSUES_JQL,
    limit: JIRA_ISSUE_MENTION_DISPLAY_LIMIT,
  });
  const issues = mergeJiraComposerIssues(remoteSearch.issues, broadSearch.issues);
  const items = toRankedJiraComposerMenuItems(issues, triggerQuery ?? "");
  return {
    items,
    isPending: broadSearch.isPending || remoteSearch.isPending,
  };
}

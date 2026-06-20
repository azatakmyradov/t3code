import type { EnvironmentId, JiraIssueSummary, ServerSettings } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";

import type { ComposerTrigger } from "../../composer-logic";
import { useJiraMentionSearch } from "./jiraState";

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
  const query = input.trigger?.kind === "jira-issue" ? input.trigger.query : null;
  const search = useJiraMentionSearch({
    environmentId: input.environmentId,
    settings: input.settings,
    query,
  });
  return {
    items: toJiraComposerMenuItems(search.issues),
    isPending: search.isPending,
  };
}

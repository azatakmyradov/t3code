import {
  JiraGetIssueInput,
  JiraIntegrationError,
  JiraIssueDetail,
  JiraListCommentsInput,
  JiraListCommentsResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import { JiraApi } from "../../../fork/jira/index.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, JiraApi];

export const JiraListCommentsTool = Tool.make("jira_list_comments", {
  description:
    "Read comments on a configured Jira Cloud ticket. Pass {issueIdOrKey:'PROJ-123'}. Returns one page of comments; page through the rest with startAt (default 0) and the maxResults you request, stopping when isLast is true. Use orderBy '-created' for newest-first.",
  parameters: JiraListCommentsInput,
  success: JiraListCommentsResult,
  failure: JiraIntegrationError,
  dependencies,
})
  .annotate(Tool.Title, "List Jira comments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const JiraGetIssueTool = Tool.make("jira_get_issue", {
  description:
    "Read the full, untruncated detail of a configured Jira Cloud ticket, including its complete description, status, assignee, reporter, and priority. Pass {issueIdOrKey:'PROJ-123'}.",
  parameters: JiraGetIssueInput,
  success: JiraIssueDetail,
  failure: JiraIntegrationError,
  dependencies,
})
  .annotate(Tool.Title, "Get Jira issue")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const JiraToolkit = Toolkit.make(JiraListCommentsTool, JiraGetIssueTool);

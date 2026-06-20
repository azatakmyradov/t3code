import { JiraIntegrationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { JiraApi } from "../../../fork/jira/index.ts";
import * as JiraToolAccess from "../../JiraToolAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { JiraToolkit } from "./tools.ts";

/**
 * Gate a Jira tool call on the invocation's `jira` capability and on the thread
 * having actually referenced a Jira ticket (see {@link JiraToolAccess}). The
 * shared capability check fails with `PreviewAutomationUnavailableError`, which
 * is not part of these tools' declared `JiraIntegrationError` failure schema, so
 * map it onto a `JiraIntegrationError` to keep the handler's error channel
 * conforming, and fail the same way when no ticket has been referenced yet.
 */
const requireJiraToolAccess = McpInvocationContext.requireMcpCapability("jira").pipe(
  Effect.catchTag(
    "PreviewAutomationUnavailableError",
    (error) =>
      new JiraIntegrationError({
        reason: "forbidden",
        message: error.message,
      }),
  ),
  Effect.flatMap((scope) =>
    JiraToolAccess.isThreadJiraReferenced(scope.threadId)
      ? Effect.void
      : Effect.fail(
          new JiraIntegrationError({
            reason: "forbidden",
            message:
              "No Jira ticket has been referenced in this thread yet. Mention a Jira issue key (for example PROJ-123) before using the Jira tools.",
          }),
        ),
  ),
);

const handlers = {
  jira_list_comments: (input) =>
    requireJiraToolAccess.pipe(
      Effect.andThen(JiraApi),
      Effect.flatMap((jira) => jira.listComments(input)),
    ),
  jira_get_issue: (input) =>
    requireJiraToolAccess.pipe(
      Effect.andThen(JiraApi),
      Effect.flatMap((jira) => jira.getIssue(input)),
    ),
} satisfies Parameters<typeof JiraToolkit.toLayer>[0];

export const JiraToolkitHandlersLive = JiraToolkit.toLayer(handlers);

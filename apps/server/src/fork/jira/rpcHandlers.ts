/**
 * Fork seam for the Jira WS RPC handlers.
 *
 * Keeps the Jira authorization-scope table and the handler implementations out
 * of upstream `ws.ts`. The upstream file spreads `FORK_JIRA_REQUIRED_SCOPE`
 * into its scope map and `makeForkJiraHandlers(jira, observeRpcEffect)` into the
 * handler object — two append points instead of ~90 inline lines.
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  type EnvironmentAuthorizationError,
  WS_METHODS,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { JiraApiShape } from "./JiraApi.ts";

/**
 * `[method, requiredScope]` pairs for every Jira RPC, intended to be spread
 * into the upstream `RPC_REQUIRED_SCOPE` map.
 */
export const FORK_JIRA_REQUIRED_SCOPE: ReadonlyArray<readonly [string, AuthEnvironmentScope]> = [
  [WS_METHODS.jiraListIssues, AuthOrchestrationReadScope],
  [WS_METHODS.jiraSearchIssueMentions, AuthOrchestrationReadScope],
  [WS_METHODS.jiraSearchUserMentions, AuthOrchestrationReadScope],
  [WS_METHODS.jiraGetIssue, AuthOrchestrationReadScope],
  [WS_METHODS.jiraGetIssueEditMetadata, AuthOrchestrationReadScope],
  [WS_METHODS.jiraListIssueTransitions, AuthOrchestrationReadScope],
  [WS_METHODS.jiraSearchAssignableUsers, AuthOrchestrationReadScope],
  [WS_METHODS.jiraAssignIssue, AuthOrchestrationOperateScope],
  [WS_METHODS.jiraUpdateIssueFields, AuthOrchestrationOperateScope],
  [WS_METHODS.jiraTransitionIssue, AuthOrchestrationOperateScope],
  [WS_METHODS.jiraValidateConnection, AuthOrchestrationReadScope],
  [WS_METHODS.jiraListComments, AuthOrchestrationReadScope],
  [WS_METHODS.jiraAddComment, AuthOrchestrationOperateScope],
  [WS_METHODS.jiraUpdateComment, AuthOrchestrationOperateScope],
  [WS_METHODS.jiraDeleteComment, AuthOrchestrationOperateScope],
  [WS_METHODS.jiraUploadAttachment, AuthOrchestrationOperateScope],
];

/** Mirrors the locally-bound `observeRpcEffect` helper in `ws.ts`. */
type ObserveRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;

const JIRA_TRACE_ATTRIBUTES = { "rpc.aggregate": "jira" } as const;

/**
 * Build the Jira RPC handler object, keyed by `WS_METHODS.jira*`, to be spread
 * into the upstream handler map passed to `WsRpcGroup.of`.
 */
export const makeForkJiraHandlers = (jira: JiraApiShape, observeRpcEffect: ObserveRpcEffect) => ({
  [WS_METHODS.jiraListIssues]: (input: Parameters<JiraApiShape["listIssues"]>[0]) =>
    observeRpcEffect(WS_METHODS.jiraListIssues, jira.listIssues(input), JIRA_TRACE_ATTRIBUTES),
  [WS_METHODS.jiraSearchIssueMentions]: (
    input: Parameters<JiraApiShape["searchIssueMentions"]>[0],
  ) =>
    observeRpcEffect(
      WS_METHODS.jiraSearchIssueMentions,
      jira.searchIssueMentions(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraSearchUserMentions]: (input: Parameters<JiraApiShape["searchUserMentions"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraSearchUserMentions,
      jira.searchUserMentions(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraGetIssue]: (input: Parameters<JiraApiShape["getIssue"]>[0]) =>
    observeRpcEffect(WS_METHODS.jiraGetIssue, jira.getIssue(input), JIRA_TRACE_ATTRIBUTES),
  [WS_METHODS.jiraGetIssueEditMetadata]: (
    input: Parameters<JiraApiShape["getIssueEditMetadata"]>[0],
  ) =>
    observeRpcEffect(
      WS_METHODS.jiraGetIssueEditMetadata,
      jira.getIssueEditMetadata(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraListIssueTransitions]: (
    input: Parameters<JiraApiShape["listIssueTransitions"]>[0],
  ) =>
    observeRpcEffect(
      WS_METHODS.jiraListIssueTransitions,
      jira.listIssueTransitions(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraSearchAssignableUsers]: (
    input: Parameters<JiraApiShape["searchAssignableUsers"]>[0],
  ) =>
    observeRpcEffect(
      WS_METHODS.jiraSearchAssignableUsers,
      jira.searchAssignableUsers(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraAssignIssue]: (input: Parameters<JiraApiShape["assignIssue"]>[0]) =>
    observeRpcEffect(WS_METHODS.jiraAssignIssue, jira.assignIssue(input), JIRA_TRACE_ATTRIBUTES),
  [WS_METHODS.jiraUpdateIssueFields]: (input: Parameters<JiraApiShape["updateIssueFields"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraUpdateIssueFields,
      jira.updateIssueFields(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraTransitionIssue]: (input: Parameters<JiraApiShape["transitionIssue"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraTransitionIssue,
      jira.transitionIssue(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraValidateConnection]: (input: Parameters<JiraApiShape["validateConnection"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraValidateConnection,
      jira.validateConnection(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraListComments]: (input: Parameters<JiraApiShape["listComments"]>[0]) =>
    observeRpcEffect(WS_METHODS.jiraListComments, jira.listComments(input), JIRA_TRACE_ATTRIBUTES),
  [WS_METHODS.jiraAddComment]: (input: Parameters<JiraApiShape["addComment"]>[0]) =>
    observeRpcEffect(WS_METHODS.jiraAddComment, jira.addComment(input), JIRA_TRACE_ATTRIBUTES),
  [WS_METHODS.jiraUpdateComment]: (input: Parameters<JiraApiShape["updateComment"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraUpdateComment,
      jira.updateComment(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraDeleteComment]: (input: Parameters<JiraApiShape["deleteComment"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraDeleteComment,
      jira.deleteComment(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
  [WS_METHODS.jiraUploadAttachment]: (input: Parameters<JiraApiShape["uploadAttachment"]>[0]) =>
    observeRpcEffect(
      WS_METHODS.jiraUploadAttachment,
      jira.uploadAttachment(input),
      JIRA_TRACE_ATTRIBUTES,
    ),
});

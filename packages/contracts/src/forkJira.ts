import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

const JIRA_SEARCH_MAX_RESULTS = 100;

export const JiraIssueKey = TrimmedNonEmptyString.pipe(Schema.brand("JiraIssueKey"));
export type JiraIssueKey = typeof JiraIssueKey.Type;

export const JiraIssueUser = Schema.Struct({
  accountId: Schema.NullOr(TrimmedNonEmptyString),
  displayName: TrimmedNonEmptyString,
  emailAddress: Schema.NullOr(TrimmedNonEmptyString),
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraIssueUser = typeof JiraIssueUser.Type;

export const JiraIssueStatus = Schema.Struct({
  name: TrimmedNonEmptyString,
  category: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraIssueStatus = typeof JiraIssueStatus.Type;

export const JiraIssueSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: JiraIssueKey,
  summary: TrimmedNonEmptyString,
  status: JiraIssueStatus,
  assignee: Schema.NullOr(JiraIssueUser),
  priority: Schema.NullOr(TrimmedNonEmptyString),
  priorityId: Schema.NullOr(TrimmedNonEmptyString),
  type: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  /**
   * Jira `project.projectTypeKey` (e.g. `service_desk`, `software`, `business`),
   * or null when Jira did not report it. Carried on the summary — not just the
   * detail — so a selected ticket's "client-facing" status is known immediately
   * from the list, without waiting on the issue-detail fetch. See
   * {@link isJiraServiceDeskProjectType}.
   */
  projectTypeKey: Schema.NullOr(TrimmedNonEmptyString),
  updated: IsoDateTime,
  url: TrimmedNonEmptyString,
});
export type JiraIssueSummary = typeof JiraIssueSummary.Type;

/**
 * Atlassian Document Format body. Validation is intentionally shallow: Jira's
 * set of supported ADF nodes evolves over time, and the renderer/editor (not
 * contracts) owns supported-node behavior. We only assert the top-level
 * envelope so arbitrary Jira payloads survive a decode/encode round trip.
 *
 * https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */
export const JiraAdfDocument = Schema.Struct({
  type: Schema.Literal("doc"),
  version: PositiveInt,
  content: Schema.Array(Schema.Unknown),
});
export type JiraAdfDocument = typeof JiraAdfDocument.Type;

/**
 * Render-time resolution for a single `media` node inside an ADF body (comment
 * or issue description), keyed by the node's Media Services UUID
 * (`media.attrs.id`). Built server-side so the client never needs the fragile
 * reverse UUID→attachment mapping.
 */
export const JiraMediaResolution = Schema.Struct({
  contentUrl: TrimmedNonEmptyString,
  thumbnailUrl: Schema.NullOr(TrimmedNonEmptyString),
  filename: Schema.String,
  mimeType: Schema.String,
});
export type JiraMediaResolution = typeof JiraMediaResolution.Type;

export const JiraIssueDetail = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: JiraIssueKey,
  summary: TrimmedNonEmptyString,
  status: JiraIssueStatus,
  assignee: Schema.NullOr(JiraIssueUser),
  reporter: Schema.NullOr(JiraIssueUser),
  priority: Schema.NullOr(TrimmedNonEmptyString),
  priorityId: Schema.NullOr(TrimmedNonEmptyString),
  type: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  /** See {@link JiraIssueSummary.projectTypeKey}. */
  projectTypeKey: Schema.NullOr(TrimmedNonEmptyString),
  updated: IsoDateTime,
  url: TrimmedNonEmptyString,
  /**
   * The issue's description as an ADF document, or null when the issue has no
   * description. Rendered read-only in the detail pane.
   */
  description: Schema.NullOr(JiraAdfDocument),
  /**
   * Lookup from a description `media` node's Media Services UUID to its resolved
   * proxy URLs and metadata. Optional and empty when the description carries no
   * media. Mirrors {@link JiraComment.mediaResolutions}.
   */
  descriptionMediaResolutions: Schema.optionalKey(
    Schema.Record(Schema.String, JiraMediaResolution),
  ),
});
export type JiraIssueDetail = typeof JiraIssueDetail.Type;

/**
 * `project.projectTypeKey` value Jira Cloud uses for Jira Service Management
 * (service desk) projects. These are the "client-facing" projects whose
 * comments distinguish an internal note from a reply visible to the customer;
 * software/business projects have no such distinction.
 */
export const JIRA_SERVICE_DESK_PROJECT_TYPE = "service_desk";

/** Whether an issue's `projectTypeKey` marks it as a client-facing JSM issue. */
export function isJiraServiceDeskProjectType(projectTypeKey: string | null | undefined): boolean {
  return projectTypeKey === JIRA_SERVICE_DESK_PROJECT_TYPE;
}

export const JiraListIssuesInput = Schema.Struct({
  jql: Schema.optionalKey(TrimmedNonEmptyString),
  nextPageToken: Schema.optionalKey(TrimmedNonEmptyString),
  maxResults: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(JIRA_SEARCH_MAX_RESULTS)),
  ),
});
export type JiraListIssuesInput = typeof JiraListIssuesInput.Type;

export const JiraListIssuesResult = Schema.Struct({
  issues: Schema.Array(JiraIssueSummary),
  nextPageToken: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraListIssuesResult = typeof JiraListIssuesResult.Type;

export const JiraSearchIssueMentionsInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(256)),
  currentJQL: Schema.optionalKey(TrimmedNonEmptyString),
  limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(JIRA_SEARCH_MAX_RESULTS))),
});
export type JiraSearchIssueMentionsInput = typeof JiraSearchIssueMentionsInput.Type;

export const JiraSearchIssueMentionsResult = Schema.Struct({
  issues: Schema.Array(JiraIssueSummary),
});
export type JiraSearchIssueMentionsResult = typeof JiraSearchIssueMentionsResult.Type;

/**
 * A user that can be @-mentioned in a comment. Unlike {@link JiraIssueUser},
 * `accountId` is required: an ADF `mention` node is meaningless without the
 * account id Jira resolves it against.
 */
export const JiraMentionUser = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  emailAddress: Schema.NullOr(TrimmedNonEmptyString),
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraMentionUser = typeof JiraMentionUser.Type;

export const JiraSearchUserMentionsInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(256)),
  limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(JIRA_SEARCH_MAX_RESULTS))),
});
export type JiraSearchUserMentionsInput = typeof JiraSearchUserMentionsInput.Type;

export const JiraSearchUserMentionsResult = Schema.Struct({
  users: Schema.Array(JiraMentionUser),
});
export type JiraSearchUserMentionsResult = typeof JiraSearchUserMentionsResult.Type;

export const JiraGetIssueInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
});
export type JiraGetIssueInput = typeof JiraGetIssueInput.Type;

export const JiraIssueFieldOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type JiraIssueFieldOption = typeof JiraIssueFieldOption.Type;

const JiraEditableFieldState = Schema.Struct({
  editable: Schema.Boolean,
  required: Schema.Boolean,
});

export const JiraEditableIssueFields = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  assignee: JiraEditableFieldState,
  priority: Schema.Struct({
    editable: Schema.Boolean,
    required: Schema.Boolean,
    allowedValues: Schema.Array(JiraIssueFieldOption),
  }),
});
export type JiraEditableIssueFields = typeof JiraEditableIssueFields.Type;

export const JiraIssueTransitionStatus = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  category: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraIssueTransitionStatus = typeof JiraIssueTransitionStatus.Type;

export const JiraIssueTransitionField = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  required: Schema.Boolean,
  supported: Schema.Boolean,
  schemaType: Schema.NullOr(TrimmedNonEmptyString),
  allowedValues: Schema.Array(JiraIssueFieldOption),
});
export type JiraIssueTransitionField = typeof JiraIssueTransitionField.Type;

export const JiraIssueTransition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  to: JiraIssueTransitionStatus,
  hasScreen: Schema.Boolean,
  fields: Schema.Array(JiraIssueTransitionField),
  unsupportedRequiredFieldIds: Schema.Array(TrimmedNonEmptyString),
});
export type JiraIssueTransition = typeof JiraIssueTransition.Type;

export const JiraListIssueTransitionsInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
});
export type JiraListIssueTransitionsInput = typeof JiraListIssueTransitionsInput.Type;

export const JiraListIssueTransitionsResult = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  transitions: Schema.Array(JiraIssueTransition),
});
export type JiraListIssueTransitionsResult = typeof JiraListIssueTransitionsResult.Type;

export const JiraSearchAssignableUsersInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  query: Schema.String.check(Schema.isMaxLength(256)),
  maxResults: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(JIRA_SEARCH_MAX_RESULTS)),
  ),
});
export type JiraSearchAssignableUsersInput = typeof JiraSearchAssignableUsersInput.Type;

export const JiraSearchAssignableUsersResult = Schema.Struct({
  users: Schema.Array(JiraIssueUser),
});
export type JiraSearchAssignableUsersResult = typeof JiraSearchAssignableUsersResult.Type;

export const JiraAssignIssueInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  accountId: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraAssignIssueInput = typeof JiraAssignIssueInput.Type;

export const JiraUpdateIssueFieldsInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  priorityId: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraUpdateIssueFieldsInput = typeof JiraUpdateIssueFieldsInput.Type;

export const JiraTransitionIssueInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  transitionId: TrimmedNonEmptyString,
  fields: Schema.optionalKey(
    Schema.Struct({
      resolutionId: Schema.optionalKey(TrimmedNonEmptyString),
      assigneeAccountId: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
      priorityId: Schema.optionalKey(TrimmedNonEmptyString),
    }),
  ),
});
export type JiraTransitionIssueInput = typeof JiraTransitionIssueInput.Type;

export const JiraIssueMutationResult = Schema.Struct({
  ok: Schema.Boolean,
});
export type JiraIssueMutationResult = typeof JiraIssueMutationResult.Type;

export const JiraValidateConnectionInput = Schema.Struct({
  siteUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  apiToken: Schema.String,
  apiTokenRedacted: Schema.optionalKey(Schema.Boolean),
});
export type JiraValidateConnectionInput = typeof JiraValidateConnectionInput.Type;

export const JiraValidateConnectionResult = Schema.Struct({
  ok: Schema.Boolean,
  siteUrl: TrimmedNonEmptyString,
  accountId: Schema.NullOr(TrimmedNonEmptyString),
  displayName: TrimmedNonEmptyString,
});
export type JiraValidateConnectionResult = typeof JiraValidateConnectionResult.Type;

const JIRA_COMMENTS_MAX_RESULTS = 100;

export const JiraCommentVisibility = Schema.Struct({
  type: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
  identifier: Schema.optionalKey(TrimmedNonEmptyString),
});
export type JiraCommentVisibility = typeof JiraCommentVisibility.Type;

/**
 * Audience for a comment on a Jira Service Management (client-facing) issue.
 * `public` is a reply visible to the customer (the reporter); `internal` is a
 * note only agents can see. Maps to the `sd.public.comment` entity property
 * (`{ internal }`) when writing and the `jsdPublic` field when reading. Only
 * meaningful on service-desk issues — see {@link isJiraServiceDeskProjectType}.
 */
export const JiraCommentAudience = Schema.Literals(["public", "internal"]);
export type JiraCommentAudience = typeof JiraCommentAudience.Type;

/**
 * Maximum size, in bytes, the server accepts for a single Jira attachment
 * upload. Mirrored on the client so oversized files are rejected before they
 * are read into memory and base64-encoded.
 */
export const JIRA_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * A file attached to a Jira issue, normalized for the fork. `restId` is the
 * REST attachment id; `mediaId` is the Media Services UUID needed to embed the
 * attachment inline in a comment body (null when it could not be resolved).
 * `contentUrl`/`thumbnailUrl` point at the fork's authenticated image proxy,
 * never at the raw Jira URLs (which require Basic auth the browser lacks).
 */
export const JiraAttachment = Schema.Struct({
  restId: TrimmedNonEmptyString,
  mediaId: Schema.NullOr(TrimmedNonEmptyString),
  filename: Schema.String,
  mimeType: Schema.String,
  size: NonNegativeInt,
  thumbnailUrl: Schema.NullOr(TrimmedNonEmptyString),
  contentUrl: TrimmedNonEmptyString,
});
export type JiraAttachment = typeof JiraAttachment.Type;

export const JiraUploadAttachmentInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  filename: TrimmedNonEmptyString,
  mimeType: Schema.String,
  /** Raw file bytes, base64-encoded (no data-URI prefix). */
  contentBase64: Schema.String,
});
export type JiraUploadAttachmentInput = typeof JiraUploadAttachmentInput.Type;

export const JiraComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  issueIdOrKey: TrimmedNonEmptyString,
  author: JiraIssueUser,
  updateAuthor: Schema.NullOr(JiraIssueUser),
  body: JiraAdfDocument,
  /**
   * Server-derived plain text rendering of `body`. Used for filtering,
   * previews, accessibility labels, and fallbacks — it is not the canonical
   * editable body.
   */
  plainText: Schema.String,
  created: IsoDateTime,
  updated: IsoDateTime,
  visibility: Schema.NullOr(JiraCommentVisibility),
  /**
   * Jira Service Management visibility: `true` when the comment is a reply
   * visible to the customer, `false` for an internal note, null when Jira did
   * not report it. Non-service-desk projects omit the field on the wire, so it
   * normalizes to null there — callers must handle null and should gate any
   * internal/customer UI on {@link isJiraServiceDeskProjectType}.
   */
  jsdPublic: Schema.NullOr(Schema.Boolean),
  url: TrimmedNonEmptyString,
  /**
   * Lookup from a body `media` node's Media Services UUID to its resolved proxy
   * URLs and metadata. Optional and empty when the comment carries no media.
   */
  mediaResolutions: Schema.optionalKey(Schema.Record(Schema.String, JiraMediaResolution)),
});
export type JiraComment = typeof JiraComment.Type;

export const JiraListCommentsInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  startAt: Schema.optionalKey(NonNegativeInt),
  maxResults: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(JIRA_COMMENTS_MAX_RESULTS)),
  ),
  orderBy: Schema.optionalKey(Schema.Literals(["created", "-created"])),
});
export type JiraListCommentsInput = typeof JiraListCommentsInput.Type;

export const JiraListCommentsResult = Schema.Struct({
  comments: Schema.Array(JiraComment),
  startAt: NonNegativeInt,
  maxResults: PositiveInt,
  total: Schema.NullOr(NonNegativeInt),
  isLast: Schema.Boolean,
});
export type JiraListCommentsResult = typeof JiraListCommentsResult.Type;

export const JiraAddCommentInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  body: JiraAdfDocument,
  /**
   * For client-facing (service-desk) issues, whether to post the comment as a
   * reply to the customer (`public`) or an internal note (`internal`). Omit on
   * normal issues so the comment is posted without a service-desk audience.
   */
  audience: Schema.optionalKey(JiraCommentAudience),
});
export type JiraAddCommentInput = typeof JiraAddCommentInput.Type;

export const JiraUpdateCommentInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  commentId: TrimmedNonEmptyString,
  body: JiraAdfDocument,
  visibility: Schema.optionalKey(Schema.NullOr(JiraCommentVisibility)),
  /**
   * For client-facing (service-desk) issues, the audience to re-assert on edit
   * so an internal note stays internal (Jira would otherwise default an edited
   * comment back to customer-visible). Omit on normal issues.
   */
  audience: Schema.optionalKey(JiraCommentAudience),
});
export type JiraUpdateCommentInput = typeof JiraUpdateCommentInput.Type;

export const JiraDeleteCommentInput = Schema.Struct({
  issueIdOrKey: TrimmedNonEmptyString,
  commentId: TrimmedNonEmptyString,
});
export type JiraDeleteCommentInput = typeof JiraDeleteCommentInput.Type;

export const JiraDeleteCommentResult = Schema.Struct({
  ok: Schema.Boolean,
});
export type JiraDeleteCommentResult = typeof JiraDeleteCommentResult.Type;

export const JiraIntegrationErrorReason = Schema.Literals([
  "not_configured",
  "invalid_config",
  "unauthorized",
  "forbidden",
  "rate_limited",
  "http_error",
  "decode_error",
  "network_error",
]);
export type JiraIntegrationErrorReason = typeof JiraIntegrationErrorReason.Type;

export class JiraIntegrationError extends Schema.TaggedErrorClass<JiraIntegrationError>()(
  "JiraIntegrationError",
  {
    reason: JiraIntegrationErrorReason,
    message: TrimmedNonEmptyString,
    status: Schema.optionalKey(NonNegativeInt),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ── Jira page filters (UI-only client filters) ────────────────────────────

export const JiraPageStatusFilter = Schema.Literals([
  "all",
  "unresolved",
  "todo",
  "inProgress",
  "done",
]);
export type JiraPageStatusFilter = typeof JiraPageStatusFilter.Type;

export const JiraPageAssigneeFilter = Schema.Literals(["currentUser", "unassigned", "any"]);
export type JiraPageAssigneeFilter = typeof JiraPageAssigneeFilter.Type;

export const JiraPageUpdatedFilter = Schema.Literals(["any", "7d", "30d"]);
export type JiraPageUpdatedFilter = typeof JiraPageUpdatedFilter.Type;

export const JiraPageSortFilter = Schema.Literals(["updatedDesc", "updatedAsc", "createdDesc"]);
export type JiraPageSortFilter = typeof JiraPageSortFilter.Type;

export const JiraPageFilters = Schema.Struct({
  space: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  status: JiraPageStatusFilter.pipe(
    Schema.withDecodingDefault(
      Effect.succeed("unresolved" as const satisfies JiraPageStatusFilter),
    ),
  ),
  assignee: JiraPageAssigneeFilter.pipe(
    Schema.withDecodingDefault(
      Effect.succeed("currentUser" as const satisfies JiraPageAssigneeFilter),
    ),
  ),
  updated: JiraPageUpdatedFilter.pipe(
    Schema.withDecodingDefault(Effect.succeed("any" as const satisfies JiraPageUpdatedFilter)),
  ),
  sort: JiraPageSortFilter.pipe(
    Schema.withDecodingDefault(Effect.succeed("updatedDesc" as const satisfies JiraPageSortFilter)),
  ),
});
export type JiraPageFilters = typeof JiraPageFilters.Type;
export const DEFAULT_JIRA_PAGE_FILTERS: JiraPageFilters = Schema.decodeSync(JiraPageFilters)({});

// ── Fork RPC seam ─────────────────────────────────────────────────────────
//
// The Jira WS method names, RPC definitions, and their aggregate array live
// here so the upstream `rpc.ts` touches only a single import plus two spreads
// (`...FORK_WS_METHODS` in `WS_METHODS`, `...FORK_JIRA_RPCS` in
// `WsRpcGroup.make`). Keeping the bodies in the fork file means an upstream
// sync conflicts on at most those append points.

export const FORK_WS_METHODS = {
  jiraListIssues: "jira.listIssues",
  jiraSearchIssueMentions: "jira.searchIssueMentions",
  jiraSearchUserMentions: "jira.searchUserMentions",
  jiraGetIssue: "jira.getIssue",
  jiraGetIssueEditMetadata: "jira.getIssueEditMetadata",
  jiraListIssueTransitions: "jira.listIssueTransitions",
  jiraSearchAssignableUsers: "jira.searchAssignableUsers",
  jiraAssignIssue: "jira.assignIssue",
  jiraUpdateIssueFields: "jira.updateIssueFields",
  jiraTransitionIssue: "jira.transitionIssue",
  jiraValidateConnection: "jira.validateConnection",
  jiraListComments: "jira.listComments",
  jiraAddComment: "jira.addComment",
  jiraUpdateComment: "jira.updateComment",
  jiraDeleteComment: "jira.deleteComment",
  jiraUploadAttachment: "jira.uploadAttachment",
} as const;

export const WsJiraListIssuesRpc = Rpc.make(FORK_WS_METHODS.jiraListIssues, {
  payload: JiraListIssuesInput,
  success: JiraListIssuesResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraSearchIssueMentionsRpc = Rpc.make(FORK_WS_METHODS.jiraSearchIssueMentions, {
  payload: JiraSearchIssueMentionsInput,
  success: JiraSearchIssueMentionsResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraSearchUserMentionsRpc = Rpc.make(FORK_WS_METHODS.jiraSearchUserMentions, {
  payload: JiraSearchUserMentionsInput,
  success: JiraSearchUserMentionsResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraGetIssueRpc = Rpc.make(FORK_WS_METHODS.jiraGetIssue, {
  payload: JiraGetIssueInput,
  success: JiraIssueDetail,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraGetIssueEditMetadataRpc = Rpc.make(FORK_WS_METHODS.jiraGetIssueEditMetadata, {
  payload: JiraGetIssueInput,
  success: JiraEditableIssueFields,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraListIssueTransitionsRpc = Rpc.make(FORK_WS_METHODS.jiraListIssueTransitions, {
  payload: JiraListIssueTransitionsInput,
  success: JiraListIssueTransitionsResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraSearchAssignableUsersRpc = Rpc.make(FORK_WS_METHODS.jiraSearchAssignableUsers, {
  payload: JiraSearchAssignableUsersInput,
  success: JiraSearchAssignableUsersResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraAssignIssueRpc = Rpc.make(FORK_WS_METHODS.jiraAssignIssue, {
  payload: JiraAssignIssueInput,
  success: JiraIssueMutationResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraUpdateIssueFieldsRpc = Rpc.make(FORK_WS_METHODS.jiraUpdateIssueFields, {
  payload: JiraUpdateIssueFieldsInput,
  success: JiraIssueMutationResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraTransitionIssueRpc = Rpc.make(FORK_WS_METHODS.jiraTransitionIssue, {
  payload: JiraTransitionIssueInput,
  success: JiraIssueMutationResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraValidateConnectionRpc = Rpc.make(FORK_WS_METHODS.jiraValidateConnection, {
  payload: JiraValidateConnectionInput,
  success: JiraValidateConnectionResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraListCommentsRpc = Rpc.make(FORK_WS_METHODS.jiraListComments, {
  payload: JiraListCommentsInput,
  success: JiraListCommentsResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraAddCommentRpc = Rpc.make(FORK_WS_METHODS.jiraAddComment, {
  payload: JiraAddCommentInput,
  success: JiraComment,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraUpdateCommentRpc = Rpc.make(FORK_WS_METHODS.jiraUpdateComment, {
  payload: JiraUpdateCommentInput,
  success: JiraComment,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraDeleteCommentRpc = Rpc.make(FORK_WS_METHODS.jiraDeleteComment, {
  payload: JiraDeleteCommentInput,
  success: JiraDeleteCommentResult,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const WsJiraUploadAttachmentRpc = Rpc.make(FORK_WS_METHODS.jiraUploadAttachment, {
  payload: JiraUploadAttachmentInput,
  success: JiraAttachment,
  error: Schema.Union([JiraIntegrationError, EnvironmentAuthorizationError]),
});

export const FORK_JIRA_RPCS = [
  WsJiraListIssuesRpc,
  WsJiraSearchIssueMentionsRpc,
  WsJiraSearchUserMentionsRpc,
  WsJiraGetIssueRpc,
  WsJiraGetIssueEditMetadataRpc,
  WsJiraListIssueTransitionsRpc,
  WsJiraSearchAssignableUsersRpc,
  WsJiraAssignIssueRpc,
  WsJiraUpdateIssueFieldsRpc,
  WsJiraTransitionIssueRpc,
  WsJiraValidateConnectionRpc,
  WsJiraListCommentsRpc,
  WsJiraAddCommentRpc,
  WsJiraUpdateCommentRpc,
  WsJiraDeleteCommentRpc,
  WsJiraUploadAttachmentRpc,
] as const;

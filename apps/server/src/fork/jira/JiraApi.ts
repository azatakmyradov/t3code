import {
  JiraIntegrationError,
  type JiraCommentAudience,
  type JiraAddCommentInput,
  type JiraAssignIssueInput,
  type JiraAttachment,
  type JiraComment,
  type JiraDeleteCommentInput,
  type JiraDeleteCommentResult,
  type JiraEditableIssueFields,
  type JiraGetIssueInput,
  type JiraIssueDetail,
  type JiraIssueMutationResult,
  type JiraListIssueTransitionsInput,
  type JiraListIssueTransitionsResult,
  type JiraListCommentsInput,
  type JiraListCommentsResult,
  type JiraListIssuesInput,
  type JiraListIssuesResult,
  type JiraSearchAssignableUsersInput,
  type JiraSearchAssignableUsersResult,
  type JiraMediaResolution,
  type JiraSearchIssueMentionsInput,
  type JiraSearchIssueMentionsResult,
  type JiraSearchUserMentionsInput,
  type JiraSearchUserMentionsResult,
  type JiraTransitionIssueInput,
  type JiraUpdateCommentInput,
  type JiraUpdateIssueFieldsInput,
  type JiraUploadAttachmentInput,
  type JiraValidateConnectionInput,
  type JiraValidateConnectionResult,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  collectJiraMediaIds,
  extractMediaUuidFromLocation,
  normalizeJiraAttachment,
  normalizeJiraComment,
  normalizeJiraEditableIssueFields,
  normalizeJiraIssueDetail,
  normalizeJiraIssueSummary,
  normalizeJiraIssueTransitions,
  normalizeJiraMentionUser,
  normalizeJiraPickerIssue,
  normalizeJiraUser,
  type RawJiraAttachment,
  RawJiraAttachmentUploadResponse,
  RawJiraComment,
  RawJiraCommentsPage,
  RawJiraIssueEditMetadata,
  RawJiraIssue,
  RawJiraIssueAttachmentsResponse,
  RawJiraIssueTransitionsResponse,
  RawJiraIssuePickerResponse,
  RawJiraMyselfResponse,
  RawJiraSearchJqlResponse,
  RawJiraUserSearchResponse,
} from "./jiraSchemas.ts";

const isJiraIntegrationError = Schema.is(JiraIntegrationError);

export interface JiraApiCredentials {
  readonly siteUrl: string;
  readonly email: string;
  readonly apiToken: string;
}

export interface JiraApiShape {
  readonly listIssues: (
    input: JiraListIssuesInput,
  ) => Effect.Effect<JiraListIssuesResult, JiraIntegrationError>;
  readonly searchIssueMentions: (
    input: JiraSearchIssueMentionsInput,
  ) => Effect.Effect<JiraSearchIssueMentionsResult, JiraIntegrationError>;
  readonly searchUserMentions: (
    input: JiraSearchUserMentionsInput,
  ) => Effect.Effect<JiraSearchUserMentionsResult, JiraIntegrationError>;
  readonly getIssue: (
    input: JiraGetIssueInput,
  ) => Effect.Effect<JiraIssueDetail, JiraIntegrationError>;
  readonly getIssueEditMetadata: (
    input: JiraGetIssueInput,
  ) => Effect.Effect<JiraEditableIssueFields, JiraIntegrationError>;
  readonly listIssueTransitions: (
    input: JiraListIssueTransitionsInput,
  ) => Effect.Effect<JiraListIssueTransitionsResult, JiraIntegrationError>;
  readonly searchAssignableUsers: (
    input: JiraSearchAssignableUsersInput,
  ) => Effect.Effect<JiraSearchAssignableUsersResult, JiraIntegrationError>;
  readonly assignIssue: (
    input: JiraAssignIssueInput,
  ) => Effect.Effect<JiraIssueMutationResult, JiraIntegrationError>;
  readonly updateIssueFields: (
    input: JiraUpdateIssueFieldsInput,
  ) => Effect.Effect<JiraIssueMutationResult, JiraIntegrationError>;
  readonly transitionIssue: (
    input: JiraTransitionIssueInput,
  ) => Effect.Effect<JiraIssueMutationResult, JiraIntegrationError>;
  readonly validateConnection: (
    input: JiraValidateConnectionInput,
  ) => Effect.Effect<JiraValidateConnectionResult, JiraIntegrationError>;
  readonly listComments: (
    input: JiraListCommentsInput,
  ) => Effect.Effect<JiraListCommentsResult, JiraIntegrationError>;
  readonly addComment: (
    input: JiraAddCommentInput,
  ) => Effect.Effect<JiraComment, JiraIntegrationError>;
  readonly updateComment: (
    input: JiraUpdateCommentInput,
  ) => Effect.Effect<JiraComment, JiraIntegrationError>;
  readonly deleteComment: (
    input: JiraDeleteCommentInput,
  ) => Effect.Effect<JiraDeleteCommentResult, JiraIntegrationError>;
  readonly uploadAttachment: (
    input: JiraUploadAttachmentInput,
  ) => Effect.Effect<JiraAttachment, JiraIntegrationError>;
}

const JIRA_COMMENTS_DEFAULT_PAGE_SIZE = 25;
const JIRA_FALLBACK_ISSUES_JQL = 'created >= "1970-01-01" ORDER BY updated DESC';

/**
 * Jira Service Management entity property that controls whether a comment is an
 * internal note (`internal: true`) or a reply visible to the customer
 * (`internal: false`). Sent in the `properties` array on comment create/update.
 * https://support.atlassian.com/jira-service-management-cloud/docs/add-comments-to-a-request/
 */
const JIRA_PUBLIC_COMMENT_PROPERTY_KEY = "sd.public.comment";

/**
 * Build the `properties` payload that sets a comment's service-desk audience,
 * or `{}` when no audience is requested (normal, non-service-desk issues), so
 * the comment is posted without touching its JSM visibility.
 */
function jiraAudienceProperties(audience: JiraCommentAudience | undefined): {
  readonly properties?: ReadonlyArray<{ readonly key: string; readonly value: unknown }>;
} {
  if (audience === undefined) return {};
  return {
    properties: [
      { key: JIRA_PUBLIC_COMMENT_PROPERTY_KEY, value: { internal: audience === "internal" } },
    ],
  };
}

export class JiraApi extends Context.Service<JiraApi, JiraApiShape>()("t3/fork/jira/JiraApi") {}

function invalidConfig(message: string, cause?: unknown): JiraIntegrationError {
  return new JiraIntegrationError({
    reason: "invalid_config",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function normalizeJiraCloudSiteUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (cause) {
    throw invalidConfig("Enter a valid Jira Cloud site URL.", cause);
  }

  if (url.protocol !== "https:") {
    throw invalidConfig("Jira site URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw invalidConfig(
      "Jira site URL must be an HTTPS origin without credentials, query, or hash.",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (url.pathname && url.pathname !== "/") {
    throw invalidConfig(
      "Jira site URL must be the site origin, for example https://site.atlassian.net.",
    );
  }
  return url.origin;
}

function jiraNotConfigured(): JiraIntegrationError {
  return new JiraIntegrationError({
    reason: "not_configured",
    message: "Jira is not configured.",
  });
}

function configuredCredentials(settings: ServerSettings) {
  const jira = settings.fork.jira;
  if (!jira.siteUrl.trim() || !jira.email.trim() || !jira.apiToken.trim()) {
    throw jiraNotConfigured();
  }
  return {
    siteUrl: normalizeJiraCloudSiteUrl(jira.siteUrl),
    email: jira.email.trim(),
    apiToken: jira.apiToken.trim(),
  } satisfies JiraApiCredentials;
}

function requestError(operation: string, cause: unknown): JiraIntegrationError {
  if (isJiraIntegrationError(cause)) {
    return cause;
  }
  return new JiraIntegrationError({
    reason: "network_error",
    message: `Failed to contact Jira while trying to ${operation}.`,
    cause,
  });
}

function extractJiraErrorMessage(body: string): string | null {
  if (!body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as {
      readonly errorMessages?: readonly string[];
      readonly errors?: Record<string, string>;
      readonly message?: string;
    };
    const messages = [
      ...(Array.isArray(parsed.errorMessages) ? parsed.errorMessages : []),
      ...Object.values(parsed.errors ?? {}),
      ...(typeof parsed.message === "string" ? [parsed.message] : []),
    ].filter((message) => message.trim().length > 0);
    return messages.length > 0 ? messages.join(" ") : null;
  } catch {
    return body.trim();
  }
}

function responseError(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, JiraIntegrationError> {
  return response.text.pipe(
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((body) => {
      const bodyMessage = extractJiraErrorMessage(body);
      if (response.status === 401) {
        return Effect.fail(
          new JiraIntegrationError({
            reason: "unauthorized",
            status: response.status,
            message: "Invalid Jira email or API token.",
          }),
        );
      }
      if (response.status === 403) {
        return Effect.fail(
          new JiraIntegrationError({
            reason: "forbidden",
            status: response.status,
            message: "Jira permissions do not allow this request.",
          }),
        );
      }
      if (response.status === 429) {
        return Effect.fail(
          new JiraIntegrationError({
            reason: "rate_limited",
            status: response.status,
            message: "Jira rate limit reached. Try again in a moment.",
          }),
        );
      }
      return Effect.fail(
        new JiraIntegrationError({
          reason: "http_error",
          status: response.status,
          message: bodyMessage
            ? `Jira returned HTTP ${response.status}: ${bodyMessage}`
            : `Jira returned HTTP ${response.status}.`,
        }),
      );
    }),
  );
}

export const make = Effect.fn("makeJiraApi")(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const serverSettings = yield* ServerSettingsService;

  const apiUrl = (credentials: JiraApiCredentials, path: string) => `${credentials.siteUrl}${path}`;

  const withAuth = (
    credentials: JiraApiCredentials,
    request: HttpClientRequest.HttpClientRequest,
  ) => request.pipe(HttpClientRequest.basicAuth(credentials.email, credentials.apiToken));

  const decodeResponse = <S extends Schema.Top>(
    operation: string,
    schema: S,
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<S["Type"], JiraIntegrationError, S["DecodingServices"]> =>
    HttpClientResponse.matchStatus({
      "2xx": (success) =>
        HttpClientResponse.schemaBodyJson(schema)(success).pipe(
          Effect.mapError(
            (cause) =>
              new JiraIntegrationError({
                reason: "decode_error",
                message: `Jira returned invalid JSON while trying to ${operation}.`,
                cause,
              }),
          ),
        ),
      orElse: responseError,
    })(response);

  const executeJson = <S extends Schema.Top>(
    operation: string,
    credentials: JiraApiCredentials,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
  ): Effect.Effect<S["Type"], JiraIntegrationError, S["DecodingServices"]> =>
    httpClient.execute(withAuth(credentials, request.pipe(HttpClientRequest.acceptJson))).pipe(
      Effect.mapError((cause) => requestError(operation, cause)),
      Effect.flatMap((response) => decodeResponse(operation, schema, response)),
    );

  const executeNoContent = (
    operation: string,
    credentials: JiraApiCredentials,
    request: HttpClientRequest.HttpClientRequest,
  ): Effect.Effect<void, JiraIntegrationError> =>
    httpClient.execute(withAuth(credentials, request)).pipe(
      Effect.mapError((cause) => requestError(operation, cause)),
      Effect.flatMap(
        HttpClientResponse.matchStatus({
          "2xx": () => Effect.void,
          orElse: responseError,
        }),
      ),
    );

  const readConfiguredCredentials = serverSettings.getSettings.pipe(
    Effect.flatMap((settings) =>
      Effect.try({
        try: () => configuredCredentials(settings),
        catch: (cause) =>
          isJiraIntegrationError(cause)
            ? cause
            : invalidConfig("Invalid Jira configuration.", cause),
      }),
    ),
    Effect.mapError((cause) =>
      isJiraIntegrationError(cause)
        ? cause
        : new JiraIntegrationError({
            reason: "invalid_config",
            message: cause.message,
            cause,
          }),
    ),
  );

  const listIssuesWithCredentials = (credentials: JiraApiCredentials, input: JiraListIssuesInput) =>
    executeJson(
      "list Jira issues",
      credentials,
      HttpClientRequest.post(apiUrl(credentials, "/rest/api/3/search/jql")).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          jql: input.jql?.trim() || JIRA_FALLBACK_ISSUES_JQL,
          maxResults: input.maxResults ?? 25,
          fields: [
            "summary",
            "status",
            "assignee",
            "reporter",
            "priority",
            "issuetype",
            "project",
            "updated",
          ],
          ...(input.nextPageToken ? { nextPageToken: input.nextPageToken } : {}),
        }),
      ),
      RawJiraSearchJqlResponse,
    ).pipe(
      Effect.map((result) => ({
        issues: result.issues.map((issue) => normalizeJiraIssueSummary(credentials.siteUrl, issue)),
        nextPageToken: result.nextPageToken?.trim() || null,
      })),
    );

  const searchIssueMentionsWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraSearchIssueMentionsInput,
  ) => {
    const query = input.query.trim();
    if (query.length === 0) {
      return listIssuesWithCredentials(credentials, {
        jql: input.currentJQL?.trim() || JIRA_FALLBACK_ISSUES_JQL,
        maxResults: input.limit ?? 10,
      }).pipe(Effect.map((result) => ({ issues: result.issues })));
    }

    return executeJson(
      "search Jira issue mentions",
      credentials,
      HttpClientRequest.get(apiUrl(credentials, "/rest/api/3/issue/picker"), {
        urlParams: {
          query,
          currentJQL: input.currentJQL?.trim() || JIRA_FALLBACK_ISSUES_JQL,
          showSubTasks: "true",
          showSubTaskParent: "true",
        },
      }),
      RawJiraIssuePickerResponse,
    ).pipe(
      Effect.map((result) => {
        const limit = input.limit ?? 10;
        return {
          issues: result.sections
            .flatMap((section) => section.issues)
            .slice(0, limit)
            .map((issue) => normalizeJiraPickerIssue(credentials.siteUrl, issue)),
        };
      }),
    );
  };

  const searchUserMentionsWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraSearchUserMentionsInput,
  ) => {
    const limit = input.limit ?? 10;
    const query = input.query.trim();
    // Jira's /user/search requires a non-empty query (or accountId) and 400s on
    // an empty one. There is no "default user list" endpoint to fall back to, so
    // an empty query yields no candidates rather than a guaranteed-failing call.
    if (query.length === 0) {
      return Effect.succeed({ users: [] } satisfies JiraSearchUserMentionsResult);
    }
    return executeJson(
      "search Jira users",
      credentials,
      HttpClientRequest.get(apiUrl(credentials, "/rest/api/3/user/search"), {
        urlParams: {
          query,
          maxResults: String(limit),
        },
      }),
      RawJiraUserSearchResponse,
    ).pipe(
      Effect.map((users) => ({
        users: users
          .map(normalizeJiraMentionUser)
          .filter((user): user is NonNullable<typeof user> => user !== null)
          .slice(0, limit),
      })),
    );
  };

  const getIssueWithCredentials = (credentials: JiraApiCredentials, input: JiraGetIssueInput) =>
    executeJson(
      "load a Jira issue",
      credentials,
      HttpClientRequest.get(
        apiUrl(credentials, `/rest/api/3/issue/${encodeURIComponent(input.issueIdOrKey.trim())}`),
        {
          urlParams: {
            fields: [
              "summary",
              "status",
              "assignee",
              "reporter",
              "priority",
              "issuetype",
              "project",
              "updated",
              "description",
            ].join(","),
          },
        },
      ),
      RawJiraIssue,
    ).pipe(
      Effect.map((issue) => normalizeJiraIssueDetail(credentials.siteUrl, issue)),
      Effect.flatMap((detail) => enrichIssueDetailWithMedia(credentials, detail)),
    );

  const issuePath = (credentials: JiraApiCredentials, issueIdOrKey: string, suffix = "") =>
    apiUrl(credentials, `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey.trim())}${suffix}`);

  const getIssueEditMetadataWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraGetIssueInput,
  ) => {
    const issueIdOrKey = input.issueIdOrKey.trim();
    return executeJson(
      "load Jira issue edit metadata",
      credentials,
      HttpClientRequest.get(issuePath(credentials, issueIdOrKey, "/editmeta")),
      RawJiraIssueEditMetadata,
    ).pipe(Effect.map((metadata) => normalizeJiraEditableIssueFields(issueIdOrKey, metadata)));
  };

  const listIssueTransitionsWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraListIssueTransitionsInput,
  ) => {
    const issueIdOrKey = input.issueIdOrKey.trim();
    return executeJson(
      "list Jira issue transitions",
      credentials,
      HttpClientRequest.get(issuePath(credentials, issueIdOrKey, "/transitions"), {
        urlParams: {
          expand: "transitions.fields",
          sortByOpsBarAndStatus: "true",
        },
      }),
      RawJiraIssueTransitionsResponse,
    ).pipe(
      Effect.map((response) => ({
        issueIdOrKey,
        transitions: [...normalizeJiraIssueTransitions(response)],
      })),
    );
  };

  const searchAssignableUsersWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraSearchAssignableUsersInput,
  ) => {
    const query = input.query.trim();
    return executeJson(
      "search Jira assignable users",
      credentials,
      HttpClientRequest.get(apiUrl(credentials, "/rest/api/3/user/assignable/search"), {
        urlParams: {
          issueKey: input.issueIdOrKey.trim(),
          ...(query ? { query } : {}),
          maxResults: String(input.maxResults ?? 10),
        },
      }),
      RawJiraUserSearchResponse,
    ).pipe(
      Effect.map((users) => ({
        users: users.map(normalizeJiraUser).filter((user): user is NonNullable<typeof user> => {
          return user !== null && user.accountId !== null;
        }),
      })),
    );
  };

  const assignIssueWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraAssignIssueInput,
  ) =>
    executeNoContent(
      "assign a Jira issue",
      credentials,
      HttpClientRequest.put(issuePath(credentials, input.issueIdOrKey, "/assignee")).pipe(
        HttpClientRequest.bodyJsonUnsafe({ accountId: input.accountId }),
      ),
    ).pipe(Effect.as({ ok: true } satisfies JiraIssueMutationResult));

  const updateIssueFieldsWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraUpdateIssueFieldsInput,
  ) =>
    executeNoContent(
      "update Jira issue fields",
      credentials,
      HttpClientRequest.put(issuePath(credentials, input.issueIdOrKey)).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          fields: {
            priority: input.priorityId === null ? null : { id: input.priorityId },
          },
        }),
      ),
    ).pipe(Effect.as({ ok: true } satisfies JiraIssueMutationResult));

  const transitionIssueWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraTransitionIssueInput,
  ) => {
    const fields: Record<string, unknown> = {};
    if (input.fields?.resolutionId !== undefined) {
      fields.resolution = { id: input.fields.resolutionId };
    }
    if (input.fields?.assigneeAccountId !== undefined) {
      fields.assignee =
        input.fields.assigneeAccountId === null
          ? null
          : { accountId: input.fields.assigneeAccountId };
    }
    if (input.fields?.priorityId !== undefined) {
      fields.priority = { id: input.fields.priorityId };
    }
    return executeNoContent(
      "transition a Jira issue",
      credentials,
      HttpClientRequest.post(issuePath(credentials, input.issueIdOrKey, "/transitions")).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          transition: { id: input.transitionId },
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
        }),
      ),
    ).pipe(Effect.as({ ok: true } satisfies JiraIssueMutationResult));
  };

  const validateConnectionWithCredentials = (credentials: JiraApiCredentials) =>
    executeJson(
      "validate Jira connection",
      credentials,
      HttpClientRequest.get(apiUrl(credentials, "/rest/api/3/myself")),
      RawJiraMyselfResponse,
    ).pipe(
      Effect.map((account) => ({
        ok: true,
        siteUrl: credentials.siteUrl,
        accountId: account.accountId?.trim() || null,
        displayName: account.displayName,
      })),
    );

  const commentPath = (credentials: JiraApiCredentials, issueIdOrKey: string, commentId?: string) =>
    apiUrl(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey.trim())}/comment${
        commentId === undefined ? "" : `/${encodeURIComponent(commentId.trim())}`
      }`,
    );

  const attachmentContentUrl = (credentials: JiraApiCredentials, restId: string) =>
    apiUrl(credentials, `/rest/api/3/attachment/content/${encodeURIComponent(restId)}`);

  /**
   * Resolve an attachment's Media Services UUID via the undocumented
   * redirect-`Location` trick (JRACLOUD-96384). Issues a no-redirect GET to the
   * attachment `content` URL and reads the UUID out of the redirect target.
   * Tolerates any failure by resolving to `null` so callers can degrade to
   * filename-chip rendering.
   */
  const resolveMediaUuid = (credentials: JiraApiCredentials, restId: string) =>
    httpClient
      .execute(
        withAuth(credentials, HttpClientRequest.get(attachmentContentUrl(credentials, restId))),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.map((response) => extractMediaUuidFromLocation(response.headers["location"])),
        Effect.scoped,
        Effect.orElseSucceed(() => null),
      );

  const fetchIssueAttachments = (credentials: JiraApiCredentials, issueIdOrKey: string) =>
    executeJson(
      "load Jira issue attachments",
      credentials,
      HttpClientRequest.get(
        apiUrl(credentials, `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}`),
        { urlParams: { fields: "attachment" } },
      ),
      RawJiraIssueAttachmentsResponse,
    ).pipe(
      Effect.map((response) => response.fields?.attachment ?? []),
      Effect.orElseSucceed(() => [] as ReadonlyArray<RawJiraAttachment>),
    );

  /**
   * Resolve the given set of `media` Media Services UUIDs to proxy-URL
   * resolutions by matching them against the issue's attachments. Best effort:
   * any failure (or an empty referenced set) yields an empty map so callers
   * degrade to filename-chip rendering.
   */
  const buildMediaResolutions = (
    credentials: JiraApiCredentials,
    issueIdOrKey: string,
    referenced: ReadonlySet<string>,
  ): Effect.Effect<ReadonlyMap<string, JiraMediaResolution>, never> =>
    Effect.gen(function* () {
      const resolutions = new Map<string, JiraMediaResolution>();
      if (referenced.size === 0) return resolutions;

      const attachments = yield* fetchIssueAttachments(credentials, issueIdOrKey);
      if (attachments.length === 0) return resolutions;

      yield* Effect.forEach(
        attachments,
        (attachment) =>
          resolveMediaUuid(credentials, attachment.id).pipe(
            Effect.map((mediaId) => {
              if (!mediaId || !referenced.has(mediaId) || resolutions.has(mediaId)) return;
              const normalized = normalizeJiraAttachment(attachment, mediaId);
              resolutions.set(mediaId, {
                contentUrl: normalized.contentUrl,
                thumbnailUrl: normalized.thumbnailUrl,
                filename: normalized.filename,
                mimeType: normalized.mimeType,
              });
            }),
          ),
        { concurrency: 5, discard: true },
      );
      return resolutions;
    }).pipe(Effect.orElseSucceed(() => new Map<string, JiraMediaResolution>()));

  /** Pick the resolutions referenced by `ids` into a plain record, or null when none. */
  const pickMediaResolutions = (
    ids: ReadonlyArray<string>,
    resolutions: ReadonlyMap<string, JiraMediaResolution>,
  ): Record<string, JiraMediaResolution> | null => {
    const map: Record<string, JiraMediaResolution> = {};
    for (const id of ids) {
      const resolution = resolutions.get(id);
      if (resolution) map[id] = resolution;
    }
    return Object.keys(map).length > 0 ? map : null;
  };

  /**
   * Resolve each `media` node referenced by the page's comment bodies to a
   * proxy-URL resolution, returning comments enriched with a per-comment
   * `mediaResolutions` map. Best effort: any failure leaves comments untouched.
   */
  const enrichCommentsWithMedia = (
    credentials: JiraApiCredentials,
    issueIdOrKey: string,
    comments: ReadonlyArray<JiraComment>,
  ): Effect.Effect<ReadonlyArray<JiraComment>, never> =>
    Effect.gen(function* () {
      const referenced = new Set<string>();
      for (const comment of comments) {
        for (const id of collectJiraMediaIds(comment.body)) referenced.add(id);
      }
      const resolutions = yield* buildMediaResolutions(credentials, issueIdOrKey, referenced);
      if (resolutions.size === 0) return comments;

      return comments.map((comment) => {
        const map = pickMediaResolutions(collectJiraMediaIds(comment.body), resolutions);
        return map === null ? comment : { ...comment, mediaResolutions: map };
      });
    }).pipe(Effect.orElseSucceed(() => comments));

  /**
   * Resolve the `media` nodes embedded in an issue's description to proxy-URL
   * resolutions, returning the detail enriched with a `descriptionMediaResolutions`
   * map. Best effort: any failure leaves the detail untouched.
   */
  const enrichIssueDetailWithMedia = (
    credentials: JiraApiCredentials,
    detail: JiraIssueDetail,
  ): Effect.Effect<JiraIssueDetail, never> =>
    Effect.gen(function* () {
      const ids = collectJiraMediaIds(detail.description);
      if (ids.length === 0) return detail;
      const resolutions = yield* buildMediaResolutions(credentials, detail.key, new Set(ids));
      const map = pickMediaResolutions(ids, resolutions);
      return map === null ? detail : { ...detail, descriptionMediaResolutions: map };
    }).pipe(Effect.orElseSucceed(() => detail));

  const listCommentsWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraListCommentsInput,
  ) => {
    const issueIdOrKey = input.issueIdOrKey.trim();
    const startAt = input.startAt ?? 0;
    const maxResults = input.maxResults ?? JIRA_COMMENTS_DEFAULT_PAGE_SIZE;
    const orderBy = input.orderBy ?? "created";
    return executeJson(
      "list Jira comments",
      credentials,
      HttpClientRequest.get(commentPath(credentials, issueIdOrKey), {
        urlParams: {
          startAt: String(startAt),
          maxResults: String(maxResults),
          orderBy,
          expand: "renderedBody",
        },
      }),
      RawJiraCommentsPage,
    ).pipe(
      Effect.flatMap((page) => {
        const normalized = page.comments.map((comment) =>
          normalizeJiraComment(credentials.siteUrl, issueIdOrKey, comment),
        );
        const resolvedStartAt = page.startAt ?? startAt;
        const resolvedMaxResults = page.maxResults ?? maxResults;
        const total = typeof page.total === "number" ? page.total : null;
        return enrichCommentsWithMedia(credentials, issueIdOrKey, normalized).pipe(
          Effect.map((comments) => {
            const isLast =
              total === null
                ? comments.length < resolvedMaxResults
                : resolvedStartAt + comments.length >= total;
            return {
              comments,
              startAt: resolvedStartAt,
              maxResults: resolvedMaxResults,
              total,
              isLast,
            } satisfies JiraListCommentsResult;
          }),
        );
      }),
    );
  };

  const addCommentWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraAddCommentInput,
  ) => {
    const issueIdOrKey = input.issueIdOrKey.trim();
    return executeJson(
      "add a Jira comment",
      credentials,
      HttpClientRequest.post(commentPath(credentials, issueIdOrKey)).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          body: input.body,
          ...jiraAudienceProperties(input.audience),
        }),
      ),
      RawJiraComment,
    ).pipe(
      Effect.map((comment) => normalizeJiraComment(credentials.siteUrl, issueIdOrKey, comment)),
    );
  };

  const updateCommentWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraUpdateCommentInput,
  ) => {
    const issueIdOrKey = input.issueIdOrKey.trim();
    return executeJson(
      "update a Jira comment",
      credentials,
      HttpClientRequest.put(commentPath(credentials, issueIdOrKey, input.commentId)).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          body: input.body,
          ...(input.visibility ? { visibility: input.visibility } : {}),
          ...jiraAudienceProperties(input.audience),
        }),
      ),
      RawJiraComment,
    ).pipe(
      Effect.map((comment) => normalizeJiraComment(credentials.siteUrl, issueIdOrKey, comment)),
    );
  };

  const deleteCommentWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraDeleteCommentInput,
  ) =>
    executeNoContent(
      "delete a Jira comment",
      credentials,
      HttpClientRequest.delete(commentPath(credentials, input.issueIdOrKey, input.commentId)),
    ).pipe(Effect.as({ ok: true } satisfies JiraDeleteCommentResult));

  const uploadAttachmentWithCredentials = (
    credentials: JiraApiCredentials,
    input: JiraUploadAttachmentInput,
  ) => {
    const issueIdOrKey = input.issueIdOrKey.trim();
    const filename = input.filename.trim() || "attachment";
    const mimeType = input.mimeType.trim() || "application/octet-stream";
    return Effect.try({
      try: () => {
        const bytes = Buffer.from(input.contentBase64, "base64");
        const formData = new FormData();
        formData.append("file", new Blob([bytes], { type: mimeType }), filename);
        return formData;
      },
      catch: (cause) => invalidConfig("Could not read the attachment to upload.", cause),
    }).pipe(
      Effect.flatMap((formData) =>
        executeJson(
          "upload a Jira attachment",
          credentials,
          HttpClientRequest.post(
            apiUrl(
              credentials,
              `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/attachments`,
            ),
          ).pipe(
            HttpClientRequest.setHeader("X-Atlassian-Token", "no-check"),
            HttpClientRequest.bodyFormData(formData),
          ),
          RawJiraAttachmentUploadResponse,
        ),
      ),
      Effect.flatMap((attachments) => {
        const attachment = attachments[0];
        if (!attachment) {
          return Effect.fail(
            new JiraIntegrationError({
              reason: "http_error",
              message: "Jira did not return the uploaded attachment.",
            }),
          );
        }
        return resolveMediaUuid(credentials, attachment.id).pipe(
          Effect.map((mediaId) => normalizeJiraAttachment(attachment, mediaId)),
        );
      }),
    );
  };

  const resolveValidationCredentials = Effect.fn("JiraApi.resolveValidationCredentials")(function* (
    input: JiraValidateConnectionInput,
  ) {
    const siteUrl = yield* Effect.try({
      try: () => normalizeJiraCloudSiteUrl(input.siteUrl),
      catch: (cause) =>
        isJiraIntegrationError(cause) ? cause : invalidConfig("Invalid Jira site URL.", cause),
    });
    const email = input.email.trim();
    let apiToken = input.apiToken.trim();

    if (!apiToken && input.apiTokenRedacted === true) {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) => invalidConfig(cause.message, cause)),
      );
      apiToken = settings.fork.jira.apiToken.trim();
    }

    if (!email || !apiToken) {
      return yield* jiraNotConfigured();
    }

    return {
      siteUrl,
      email,
      apiToken,
    } satisfies JiraApiCredentials;
  });

  // Every method (except validateConnection, which can test unsaved
  // credentials) resolves the configured credentials, then delegates to the
  // matching `*WithCredentials` implementation.
  const withCredentials =
    <Input, A, E, R>(
      fn: (credentials: JiraApiCredentials, input: Input) => Effect.Effect<A, E, R>,
    ) =>
    (input: Input) =>
      readConfiguredCredentials.pipe(Effect.flatMap((credentials) => fn(credentials, input)));

  return JiraApi.of({
    listIssues: withCredentials(listIssuesWithCredentials),
    searchIssueMentions: withCredentials(searchIssueMentionsWithCredentials),
    searchUserMentions: withCredentials(searchUserMentionsWithCredentials),
    getIssue: withCredentials(getIssueWithCredentials),
    getIssueEditMetadata: withCredentials(getIssueEditMetadataWithCredentials),
    listIssueTransitions: withCredentials(listIssueTransitionsWithCredentials),
    searchAssignableUsers: withCredentials(searchAssignableUsersWithCredentials),
    assignIssue: withCredentials(assignIssueWithCredentials),
    updateIssueFields: withCredentials(updateIssueFieldsWithCredentials),
    transitionIssue: withCredentials(transitionIssueWithCredentials),
    validateConnection: (input) =>
      resolveValidationCredentials(input).pipe(Effect.flatMap(validateConnectionWithCredentials)),
    listComments: withCredentials(listCommentsWithCredentials),
    addComment: withCredentials(addCommentWithCredentials),
    updateComment: withCredentials(updateCommentWithCredentials),
    deleteComment: withCredentials(deleteCommentWithCredentials),
    uploadAttachment: withCredentials(uploadAttachmentWithCredentials),
  });
});

export const layer = Layer.effect(JiraApi, make());

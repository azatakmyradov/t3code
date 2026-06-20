import {
  JiraIssueKey,
  type JiraAdfDocument,
  type JiraAttachment,
  type JiraComment,
  type JiraCommentVisibility,
  type JiraEditableIssueFields,
  type JiraIssueFieldOption,
  type JiraIssueDetail,
  type JiraIssueSummary,
  type JiraIssueTransition,
  type JiraIssueTransitionField,
  type JiraIssueUser,
  type JiraMentionUser,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const RawAvatarUrls = Schema.Record(Schema.String, Schema.String);

export const RawJiraUser = Schema.Struct({
  accountId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  emailAddress: Schema.optionalKey(Schema.NullOr(Schema.String)),
  avatarUrls: Schema.optionalKey(Schema.NullOr(RawAvatarUrls)),
});
export type RawJiraUser = typeof RawJiraUser.Type;

const RawNamedEntity = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const RawJiraStatus = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  statusCategory: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

const RawJiraProject = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  key: Schema.optionalKey(Schema.NullOr(Schema.String)),
  projectTypeKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const RawJiraIssueFields = Schema.Struct({
  summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  status: Schema.optionalKey(Schema.NullOr(RawJiraStatus)),
  assignee: Schema.optionalKey(Schema.NullOr(RawJiraUser)),
  reporter: Schema.optionalKey(Schema.NullOr(RawJiraUser)),
  priority: Schema.optionalKey(Schema.NullOr(RawNamedEntity)),
  issuetype: Schema.optionalKey(Schema.NullOr(RawNamedEntity)),
  project: Schema.optionalKey(Schema.NullOr(RawJiraProject)),
  updated: Schema.optionalKey(Schema.NullOr(Schema.String)),
  // ADF description body. Kept permissive (unknown) like comment bodies;
  // normalizeJiraIssueDetail coerces it to a valid envelope or null.
  description: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
});
export type RawJiraIssueFields = typeof RawJiraIssueFields.Type;

export const RawJiraIssue = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.optionalKey(Schema.NullOr(RawJiraIssueFields)),
});
export type RawJiraIssue = typeof RawJiraIssue.Type;

export const RawJiraSearchJqlResponse = Schema.Struct({
  issues: Schema.Array(RawJiraIssue),
  nextPageToken: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type RawJiraSearchJqlResponse = typeof RawJiraSearchJqlResponse.Type;

export const RawJiraIssuePickerIssue = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  key: Schema.String,
  summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  summaryText: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type RawJiraIssuePickerIssue = typeof RawJiraIssuePickerIssue.Type;

export const RawJiraIssuePickerResponse = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({
      issues: Schema.Array(RawJiraIssuePickerIssue),
    }),
  ),
});
export type RawJiraIssuePickerResponse = typeof RawJiraIssuePickerResponse.Type;

export const RawJiraMyselfResponse = Schema.Struct({
  accountId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.String,
});
export type RawJiraMyselfResponse = typeof RawJiraMyselfResponse.Type;

/** `GET /user/search` and `/user/assignable/search` both return a user array. */
export const RawJiraUserSearchResponse = Schema.Array(RawJiraUser);
export type RawJiraUserSearchResponse = typeof RawJiraUserSearchResponse.Type;

const RawJiraAllowedValue = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  accountId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const RawJiraFieldSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const RawJiraMetadataField = Schema.Struct({
  required: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  schema: Schema.optionalKey(Schema.NullOr(RawJiraFieldSchema)),
  allowedValues: Schema.optionalKey(Schema.NullOr(Schema.Array(RawJiraAllowedValue))),
});

export const RawJiraIssueEditMetadata = Schema.Struct({
  fields: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, RawJiraMetadataField))),
});
export type RawJiraIssueEditMetadata = typeof RawJiraIssueEditMetadata.Type;

const RawJiraTransitionStatus = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  statusCategory: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.optionalKey(Schema.NullOr(Schema.String)),
        key: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

const RawJiraTransition = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  to: RawJiraTransitionStatus,
  hasScreen: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  fields: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, RawJiraMetadataField))),
});

export const RawJiraIssueTransitionsResponse = Schema.Struct({
  transitions: Schema.Array(RawJiraTransition),
});
export type RawJiraIssueTransitionsResponse = typeof RawJiraIssueTransitionsResponse.Type;

export const RawJiraCommentVisibility = Schema.Struct({
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  value: Schema.optionalKey(Schema.NullOr(Schema.String)),
  identifier: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type RawJiraCommentVisibility = typeof RawJiraCommentVisibility.Type;

/**
 * Jira comment bodies are Atlassian Document Format (ADF) JSON. We keep the raw
 * shape permissive (`body` is unknown) because the supported ADF node set
 * evolves; {@link normalizeJiraComment} coerces it to a valid envelope.
 */
export const RawJiraComment = Schema.Struct({
  id: Schema.String,
  author: Schema.optionalKey(Schema.NullOr(RawJiraUser)),
  updateAuthor: Schema.optionalKey(Schema.NullOr(RawJiraUser)),
  body: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  created: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated: Schema.optionalKey(Schema.NullOr(Schema.String)),
  visibility: Schema.optionalKey(Schema.NullOr(RawJiraCommentVisibility)),
  jsdPublic: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});
export type RawJiraComment = typeof RawJiraComment.Type;

export const RawJiraCommentsPage = Schema.Struct({
  comments: Schema.Array(RawJiraComment),
  startAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  maxResults: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  total: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type RawJiraCommentsPage = typeof RawJiraCommentsPage.Type;

/**
 * A Jira attachment as returned by `POST /issue/{key}/attachments` (array
 * items) and by the `attachment` field on `GET /issue/{key}`. `content` and
 * `thumbnail` are absolute Jira URLs requiring Basic auth.
 */
export const RawJiraAttachment = Schema.Struct({
  id: Schema.String,
  filename: Schema.optionalKey(Schema.NullOr(Schema.String)),
  mimeType: Schema.optionalKey(Schema.NullOr(Schema.String)),
  size: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  content: Schema.optionalKey(Schema.NullOr(Schema.String)),
  thumbnail: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type RawJiraAttachment = typeof RawJiraAttachment.Type;

/** The `POST /issue/{key}/attachments` response is an array of attachments. */
export const RawJiraAttachmentUploadResponse = Schema.Array(RawJiraAttachment);
export type RawJiraAttachmentUploadResponse = typeof RawJiraAttachmentUploadResponse.Type;

/** `GET /issue/{key}?fields=attachment` carries the attachment list in fields. */
export const RawJiraIssueAttachmentsResponse = Schema.Struct({
  fields: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        attachment: Schema.optionalKey(Schema.NullOr(Schema.Array(RawJiraAttachment))),
      }),
    ),
  ),
});
export type RawJiraIssueAttachmentsResponse = typeof RawJiraIssueAttachmentsResponse.Type;

function nonEmpty(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function avatarUrl(user: RawJiraUser): string | null {
  const avatars = user.avatarUrls;
  if (!avatars) return null;
  return avatars["48x48"] ?? avatars["32x32"] ?? avatars["24x24"] ?? avatars["16x16"] ?? null;
}

export function normalizeJiraUser(user: RawJiraUser | null | undefined): JiraIssueUser | null {
  if (!user) return null;
  const displayName = nonEmpty(user.displayName, user.emailAddress ?? user.accountId ?? "Unknown");
  return {
    accountId: nonEmpty(user.accountId, "") || null,
    displayName,
    emailAddress: nonEmpty(user.emailAddress, "") || null,
    avatarUrl: avatarUrl(user),
  };
}

/**
 * Normalize a raw user into a mentionable one. Returns null when the account id
 * is missing: an ADF `mention` node cannot be resolved without it, so such users
 * are not offered as mention candidates.
 */
export function normalizeJiraMentionUser(
  user: RawJiraUser | null | undefined,
): JiraMentionUser | null {
  const accountId = nonEmpty(user?.accountId, "");
  if (!user || !accountId) return null;
  return {
    accountId,
    displayName: nonEmpty(user.displayName, user.emailAddress ?? accountId),
    emailAddress: nonEmpty(user.emailAddress, "") || null,
    avatarUrl: avatarUrl(user),
  };
}

function normalizeFieldOption(value: typeof RawJiraAllowedValue.Type): JiraIssueFieldOption | null {
  const id = nonEmpty(value.id ?? value.accountId, "");
  const name = nonEmpty(value.name ?? value.displayName, id);
  if (!id || !name) return null;
  return { id, name };
}

function normalizeFieldOptions(
  values: ReadonlyArray<typeof RawJiraAllowedValue.Type> | null | undefined,
): ReadonlyArray<JiraIssueFieldOption> {
  if (!values) return [];
  return values
    .map(normalizeFieldOption)
    .filter((option): option is JiraIssueFieldOption => option !== null);
}

function isSupportedTransitionField(
  fieldId: string,
  allowedValues: ReadonlyArray<JiraIssueFieldOption>,
): boolean {
  switch (fieldId) {
    case "resolution":
    case "priority":
      return allowedValues.length > 0;
    case "assignee":
      return true;
    default:
      return false;
  }
}

export function normalizeJiraEditableIssueFields(
  issueIdOrKey: string,
  metadata: RawJiraIssueEditMetadata,
): JiraEditableIssueFields {
  const fields = metadata.fields ?? {};
  const assignee = fields.assignee;
  const priority = fields.priority;
  return {
    issueIdOrKey,
    assignee: {
      editable: assignee !== undefined,
      required: assignee?.required === true,
    },
    priority: {
      editable: priority !== undefined,
      required: priority?.required === true,
      allowedValues: [...normalizeFieldOptions(priority?.allowedValues)],
    },
  };
}

function normalizeJiraTransitionField(
  fieldId: string,
  field: typeof RawJiraMetadataField.Type,
): JiraIssueTransitionField {
  const allowedValues = normalizeFieldOptions(field.allowedValues);
  return {
    id: fieldId,
    name: nonEmpty(field.name, fieldId),
    required: field.required === true,
    supported: isSupportedTransitionField(fieldId, allowedValues),
    schemaType: nonEmpty(field.schema?.type, "") || null,
    allowedValues: [...allowedValues],
  };
}

export function normalizeJiraIssueTransitions(
  response: RawJiraIssueTransitionsResponse,
): ReadonlyArray<JiraIssueTransition> {
  return response.transitions.map((transition) => {
    const fields = Object.entries(transition.fields ?? {}).map(([fieldId, field]) =>
      normalizeJiraTransitionField(fieldId, field),
    );
    return {
      id: transition.id,
      name: nonEmpty(transition.name, transition.id),
      to: {
        id: nonEmpty(transition.to.id, transition.id),
        name: nonEmpty(transition.to.name, "Unknown"),
        category:
          nonEmpty(transition.to.statusCategory?.key, "") ||
          nonEmpty(transition.to.statusCategory?.name, "") ||
          null,
      },
      hasScreen: transition.hasScreen === true,
      fields,
      unsupportedRequiredFieldIds: fields
        .filter((field) => field.required && !field.supported)
        .map((field) => field.id),
    };
  });
}

export function jiraBrowseUrl(siteUrl: string, key: string): string {
  return `${siteUrl}/browse/${encodeURIComponent(key)}`;
}

/** Recover the issue key from a `/browse/KEY` URL (inverse of {@link jiraBrowseUrl}). */
export function jiraIssueKeyFromBrowseUrl(url: string): string | null {
  const match = /\/browse\/([^/?#]+)/u.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function normalizeJiraIssueSummary(siteUrl: string, issue: RawJiraIssue): JiraIssueSummary {
  const fields = issue.fields ?? null;
  const projectKey = nonEmpty(fields?.project?.key, issue.key.split("-")[0] ?? "Jira");
  return {
    id: nonEmpty(issue.id, issue.key),
    key: JiraIssueKey.make(nonEmpty(issue.key, issue.id)),
    summary: nonEmpty(fields?.summary, issue.key),
    status: {
      name: nonEmpty(fields?.status?.name, "Unknown"),
      category: nonEmpty(fields?.status?.statusCategory?.name, "") || null,
    },
    assignee: normalizeJiraUser(fields?.assignee),
    priority: nonEmpty(fields?.priority?.name, "") || null,
    priorityId: nonEmpty(fields?.priority?.id, "") || null,
    type: nonEmpty(fields?.issuetype?.name, "Issue"),
    project: nonEmpty(fields?.project?.name, projectKey),
    projectTypeKey: nonEmpty(fields?.project?.projectTypeKey, "") || null,
    updated: nonEmpty(fields?.updated, ""),
    url: jiraBrowseUrl(siteUrl, issue.key),
  };
}

export function normalizeJiraIssueDetail(siteUrl: string, issue: RawJiraIssue): JiraIssueDetail {
  const summary = normalizeJiraIssueSummary(siteUrl, issue);
  return {
    ...summary,
    reporter: normalizeJiraUser(issue.fields?.reporter),
    description: toNullableAdfDocument(issue.fields?.description),
  };
}

const ADF_BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "rule",
  "panel",
  "mediaSingle",
  "mediaGroup",
  "table",
  "tableRow",
]);

function emptyAdfDocument(): JiraAdfDocument {
  return { type: "doc", version: 1, content: [] };
}

/**
 * Coerce an arbitrary Jira body payload into a valid ADF envelope. Jira always
 * returns ADF for `expand`-less comment bodies, but we never trust the shape:
 * anything that is not a well-formed `doc` becomes an empty document.
 */
function toAdfDocument(value: unknown): JiraAdfDocument {
  if (!value || typeof value !== "object") return emptyAdfDocument();
  const node = value as { readonly type?: unknown; readonly content?: unknown };
  if (node.type !== "doc") return emptyAdfDocument();
  return {
    type: "doc",
    version: 1,
    content: Array.isArray(node.content) ? (node.content as ReadonlyArray<unknown>) : [],
  };
}

/**
 * Like {@link toAdfDocument}, but returns null for a missing, malformed, or
 * empty body. Used for issue descriptions, which Jira returns as `null` when the
 * issue has no description — preserving that null lets the UI skip the section
 * entirely rather than render an empty document.
 */
function toNullableAdfDocument(value: unknown): JiraAdfDocument | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { readonly type?: unknown }).type !== "doc") return null;
  const document = toAdfDocument(value);
  return document.content.length > 0 ? document : null;
}

/**
 * Best-effort plain-text extraction from an ADF document. Traverses unknown
 * nesting safely, appends text nodes, treats `hardBreak` as a newline, and
 * separates block nodes with newlines. Unknown attrs/marks are ignored and
 * malformed nested content never throws — it returns `""`.
 */
export function extractPlainTextFromAdf(document: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as {
      readonly type?: unknown;
      readonly text?: unknown;
      readonly attrs?: unknown;
      readonly content?: unknown;
    };
    if (record.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    if (record.type === "mention") {
      const text = (record.attrs as { readonly text?: unknown } | null | undefined)?.text;
      parts.push(typeof text === "string" && text.length > 0 ? text : "@unknown");
      return;
    }
    if (record.type === "inlineCard") {
      const url = (record.attrs as { readonly url?: unknown } | null | undefined)?.url;
      if (typeof url === "string" && url.length > 0) {
        parts.push(jiraIssueKeyFromBrowseUrl(url) ?? url);
      }
      return;
    }
    if (typeof record.text === "string") {
      parts.push(record.text);
    }
    if (Array.isArray(record.content)) {
      for (const child of record.content) walk(child);
    }
    if (typeof record.type === "string" && ADF_BLOCK_NODE_TYPES.has(record.type)) {
      parts.push("\n");
    }
  };

  try {
    walk(document);
  } catch {
    return "";
  }

  return parts
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

export function jiraIssueCommentUrl(siteUrl: string, issueKey: string, commentId: string): string {
  return `${siteUrl}/browse/${encodeURIComponent(issueKey)}?focusedCommentId=${encodeURIComponent(
    commentId,
  )}`;
}

function normalizeJiraCommentVisibility(
  visibility: RawJiraCommentVisibility | null | undefined,
): JiraCommentVisibility | null {
  if (!visibility) return null;
  const type = nonEmpty(visibility.type, "");
  const value = nonEmpty(visibility.value, "");
  if (!type || !value) return null;
  const identifier = nonEmpty(visibility.identifier, "");
  return {
    type,
    value,
    ...(identifier ? { identifier } : {}),
  };
}

const UNKNOWN_JIRA_COMMENT_AUTHOR: JiraIssueUser = {
  accountId: null,
  displayName: "Unknown",
  emailAddress: null,
  avatarUrl: null,
};

export function normalizeJiraComment(
  siteUrl: string,
  issueIdOrKey: string,
  comment: RawJiraComment,
): JiraComment {
  const body = toAdfDocument(comment.body);
  return {
    id: nonEmpty(comment.id, comment.id),
    issueIdOrKey,
    author: normalizeJiraUser(comment.author) ?? UNKNOWN_JIRA_COMMENT_AUTHOR,
    updateAuthor: normalizeJiraUser(comment.updateAuthor),
    body,
    plainText: extractPlainTextFromAdf(body),
    created: nonEmpty(comment.created, ""),
    updated: nonEmpty(comment.updated, ""),
    visibility: normalizeJiraCommentVisibility(comment.visibility),
    jsdPublic: typeof comment.jsdPublic === "boolean" ? comment.jsdPublic : null,
    url: jiraIssueCommentUrl(siteUrl, issueIdOrKey, comment.id),
  };
}

/**
 * Route prefix for the fork's authenticated Jira attachment image proxy. Lives
 * under `/api` so that (a) the Vite dev server proxies it to the backend in
 * development — it only forwards `/api`, `/.well-known`, and `/attachments` —
 * and (b) browser `<img>`/link requests stay same-origin with the page, which
 * is how they carry the session cookie the proxy authenticates with.
 */
export const JIRA_ATTACHMENT_ROUTE_PREFIX = "/api/jira-attachment";

export function jiraAttachmentProxyUrl(restId: string, kind: "content" | "thumbnail"): string {
  return `${JIRA_ATTACHMENT_ROUTE_PREFIX}/${kind}/${encodeURIComponent(restId)}`;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/**
 * Build a normalized {@link JiraAttachment} with proxy URLs. `mediaId` is the
 * Media Services UUID resolved out-of-band (null when unavailable). Thumbnails
 * are only offered for image attachments, since Jira's thumbnail endpoint only
 * serves images.
 */
export function normalizeJiraAttachment(
  attachment: RawJiraAttachment,
  mediaId: string | null,
): JiraAttachment {
  const restId = nonEmpty(attachment.id, attachment.id);
  const mimeType = nonEmpty(attachment.mimeType, "application/octet-stream");
  const rawSize = typeof attachment.size === "number" ? attachment.size : 0;
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.trunc(rawSize) : 0;
  return {
    restId,
    mediaId: mediaId?.trim() || null,
    filename: nonEmpty(attachment.filename, restId),
    mimeType,
    size,
    thumbnailUrl: isImageMimeType(mimeType) ? jiraAttachmentProxyUrl(restId, "thumbnail") : null,
    contentUrl: jiraAttachmentProxyUrl(restId, "content"),
  };
}

const MEDIA_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

/**
 * Extract a Media Services UUID from the `Location` header returned when an
 * attachment `content` URL is fetched without following redirects. The redirect
 * target embeds the UUID (e.g. `.../file/<uuid>/binary?...`). Returns null when
 * no UUID is present — callers degrade to filename-chip rendering.
 */
export function extractMediaUuidFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const match = MEDIA_UUID_PATTERN.exec(location);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Collect the set of Media Services UUIDs referenced by `media` nodes inside an
 * ADF document. Traverses unknown nesting safely and never throws.
 */
export function collectJiraMediaIds(document: unknown): ReadonlyArray<string> {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as {
      readonly type?: unknown;
      readonly attrs?: unknown;
      readonly content?: unknown;
    };
    if (record.type === "media") {
      const attrs = record.attrs as { readonly id?: unknown } | null | undefined;
      const id = typeof attrs?.id === "string" ? attrs.id.trim() : "";
      if (id) ids.add(id);
    }
    if (Array.isArray(record.content)) {
      for (const child of record.content) walk(child);
    }
  };
  try {
    walk(document);
  } catch {
    return [];
  }
  return [...ids];
}

export function normalizeJiraPickerIssue(
  siteUrl: string,
  issue: RawJiraIssuePickerIssue,
): JiraIssueSummary {
  const summary = stripHtml(nonEmpty(issue.summaryText, issue.summary ?? issue.key));
  const project = issue.key.split("-")[0] ?? "Jira";
  return {
    id: nonEmpty(issue.id, issue.key),
    key: JiraIssueKey.make(issue.key),
    summary: nonEmpty(summary, issue.key),
    status: { name: "Unknown", category: null },
    assignee: null,
    priority: null,
    priorityId: null,
    type: "Issue",
    project,
    // The issue picker does not return project metadata, so the project type is
    // unknown here; callers that need it must load the issue detail.
    projectTypeKey: null,
    updated: "",
    url: jiraBrowseUrl(siteUrl, issue.key),
  };
}

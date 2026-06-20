import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  JiraAddCommentInput,
  JiraAdfDocument,
  JiraAttachment,
  JiraComment,
  JiraDeleteCommentInput,
  JiraDeleteCommentResult,
  JiraEditableIssueFields,
  JiraGetIssueInput,
  JiraIntegrationError,
  JiraIssueDetail,
  JiraIssueKey,
  JiraIssueMutationResult,
  JiraListIssueTransitionsInput,
  JiraListIssueTransitionsResult,
  isJiraServiceDeskProjectType,
  JiraListCommentsInput,
  JiraListIssuesInput,
  JiraListIssuesResult,
  JiraAssignIssueInput,
  JiraSearchAssignableUsersInput,
  JiraSearchAssignableUsersResult,
  JiraSearchIssueMentionsInput,
  JiraSearchIssueMentionsResult,
  JiraSearchUserMentionsInput,
  JiraSearchUserMentionsResult,
  JiraTransitionIssueInput,
  JiraUpdateCommentInput,
  JiraUpdateIssueFieldsInput,
  JiraUploadAttachmentInput,
  JiraValidateConnectionInput,
  JiraValidateConnectionResult,
} from "./forkJira.ts";

const decodeIssueDetail = Schema.decodeUnknownSync(JiraIssueDetail);
const encodeIssueDetail = Schema.encodeSync(JiraIssueDetail);
const decodeListIssuesInput = Schema.decodeUnknownSync(JiraListIssuesInput);
const decodeListIssuesResult = Schema.decodeUnknownSync(JiraListIssuesResult);
const encodeListIssuesResult = Schema.encodeSync(JiraListIssuesResult);
const decodeSearchIssueMentionsInput = Schema.decodeUnknownSync(JiraSearchIssueMentionsInput);
const decodeSearchIssueMentionsResult = Schema.decodeUnknownSync(JiraSearchIssueMentionsResult);
const decodeSearchUserMentionsInput = Schema.decodeUnknownSync(JiraSearchUserMentionsInput);
const decodeSearchUserMentionsResult = Schema.decodeUnknownSync(JiraSearchUserMentionsResult);
const decodeGetIssueInput = Schema.decodeUnknownSync(JiraGetIssueInput);
const decodeEditableIssueFields = Schema.decodeUnknownSync(JiraEditableIssueFields);
const decodeListIssueTransitionsInput = Schema.decodeUnknownSync(JiraListIssueTransitionsInput);
const decodeListIssueTransitionsResult = Schema.decodeUnknownSync(JiraListIssueTransitionsResult);
const decodeSearchAssignableUsersInput = Schema.decodeUnknownSync(JiraSearchAssignableUsersInput);
const decodeSearchAssignableUsersResult = Schema.decodeUnknownSync(JiraSearchAssignableUsersResult);
const decodeAssignIssueInput = Schema.decodeUnknownSync(JiraAssignIssueInput);
const decodeUpdateIssueFieldsInput = Schema.decodeUnknownSync(JiraUpdateIssueFieldsInput);
const decodeTransitionIssueInput = Schema.decodeUnknownSync(JiraTransitionIssueInput);
const decodeIssueMutationResult = Schema.decodeUnknownSync(JiraIssueMutationResult);
const decodeValidateConnectionInput = Schema.decodeUnknownSync(JiraValidateConnectionInput);
const decodeValidateConnectionResult = Schema.decodeUnknownSync(JiraValidateConnectionResult);
const decodeJiraIntegrationError = Schema.decodeUnknownSync(JiraIntegrationError);
const decodeAdfDocument = Schema.decodeUnknownSync(JiraAdfDocument);
const encodeAdfDocument = Schema.encodeSync(JiraAdfDocument);
const decodeComment = Schema.decodeUnknownSync(JiraComment);
const encodeComment = Schema.encodeSync(JiraComment);
const decodeListCommentsInput = Schema.decodeUnknownSync(JiraListCommentsInput);
const decodeAddCommentInput = Schema.decodeUnknownSync(JiraAddCommentInput);
const decodeUpdateCommentInput = Schema.decodeUnknownSync(JiraUpdateCommentInput);
const decodeDeleteCommentInput = Schema.decodeUnknownSync(JiraDeleteCommentInput);
const decodeDeleteCommentResult = Schema.decodeUnknownSync(JiraDeleteCommentResult);
const decodeAttachment = Schema.decodeUnknownSync(JiraAttachment);
const encodeAttachment = Schema.encodeSync(JiraAttachment);
const decodeUploadAttachmentInput = Schema.decodeUnknownSync(JiraUploadAttachmentInput);

const sampleAdf = {
  type: "doc" as const,
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text: "Looks good" }] }],
};

const sampleComment = {
  id: "10100",
  issueIdOrKey: "ABC-123",
  author: {
    accountId: "abc-account",
    displayName: "Ada Lovelace",
    emailAddress: "ada@example.com",
    avatarUrl: "https://example.atlassian.net/avatar.png",
  },
  updateAuthor: null,
  body: sampleAdf,
  plainText: "Looks good",
  created: "2026-01-02T03:04:05.000+0000",
  updated: "2026-01-02T03:04:05.000+0000",
  visibility: null,
  jsdPublic: null,
  url: "https://example.atlassian.net/browse/ABC-123?focusedCommentId=10100",
};

const sampleIssue = {
  id: "10001",
  key: "ABC-123",
  summary: "Fix failing deployment",
  status: { name: "In Progress", category: "indeterminate" },
  assignee: {
    accountId: "abc-account",
    displayName: "Ada Lovelace",
    emailAddress: "ada@example.com",
    avatarUrl: "https://example.atlassian.net/avatar.png",
  },
  reporter: {
    accountId: "reporter-account",
    displayName: "Grace Hopper",
    emailAddress: null,
    avatarUrl: null,
  },
  priority: "High",
  priorityId: "2",
  type: "Bug",
  project: "Platform",
  projectTypeKey: null,
  updated: "2026-01-02T03:04:05.000+0000",
  url: "https://example.atlassian.net/browse/ABC-123",
  description: null,
};

describe("Jira contracts", () => {
  it("decodes and encodes Jira issue details", () => {
    const decoded = decodeIssueDetail(sampleIssue);
    expect(decoded.key).toBe(JiraIssueKey.make("ABC-123"));
    expect(decoded.assignee?.displayName).toBe("Ada Lovelace");
    expect(decoded.priority).toBe("High");
    expect(decoded.priorityId).toBe("2");
    expect(encodeIssueDetail(decoded)).toEqual(sampleIssue);
  });

  it("decodes list, mention, get, and validation inputs", () => {
    expect(decodeListIssuesInput({ maxResults: 20 })).toEqual({
      maxResults: 20,
    });
    expect(
      decodeListIssuesInput({
        jql: " project = ABC ",
        nextPageToken: " token-1 ",
      }),
    ).toEqual({ jql: "project = ABC", nextPageToken: "token-1" });
    expect(
      decodeSearchIssueMentionsInput({
        query: "ABC",
        currentJQL: " project = ABC ",
        limit: 10,
      }),
    ).toEqual({ query: "ABC", currentJQL: "project = ABC", limit: 10 });
    expect(decodeGetIssueInput({ issueIdOrKey: " ABC-123 " })).toEqual({
      issueIdOrKey: "ABC-123",
    });
    expect(
      decodeValidateConnectionInput({
        siteUrl: " https://example.atlassian.net ",
        email: " ada@example.com ",
        apiToken: " token ",
        apiTokenRedacted: true,
      }),
    ).toEqual({
      siteUrl: "https://example.atlassian.net",
      email: "ada@example.com",
      apiToken: " token ",
      apiTokenRedacted: true,
    });
  });

  it("rejects invalid Jira result limits", () => {
    expect(() => decodeListIssuesInput({ maxResults: 101 })).toThrow();
    expect(() => decodeSearchIssueMentionsInput({ query: "ABC", limit: 0 })).toThrow();
  });

  it("decodes user mention search inputs and results", () => {
    expect(
      decodeSearchUserMentionsInput({
        query: "ada",
        limit: 10,
      }),
    ).toEqual({ query: "ada", limit: 10 });
    expect(decodeSearchUserMentionsInput({ query: "" })).toEqual({ query: "" });
    expect(() => decodeSearchUserMentionsInput({ query: "ada", limit: 0 })).toThrow();

    const result = decodeSearchUserMentionsResult({
      users: [
        {
          accountId: " abc-account ",
          displayName: " Ada Lovelace ",
          emailAddress: "ada@example.com",
          avatarUrl: null,
        },
      ],
    });
    expect(result.users[0]?.accountId).toBe("abc-account");
    expect(result.users[0]?.displayName).toBe("Ada Lovelace");
    // accountId is required for a mention; an empty one is rejected.
    expect(() =>
      decodeSearchUserMentionsResult({
        users: [{ accountId: "", displayName: "Nobody", emailAddress: null, avatarUrl: null }],
      }),
    ).toThrow();
  });

  it("decodes editable issue field metadata", () => {
    expect(
      decodeEditableIssueFields({
        issueIdOrKey: " ABC-123 ",
        assignee: { editable: true, required: false },
        priority: {
          editable: true,
          required: true,
          allowedValues: [
            { id: " 1 ", name: " Highest " },
            { id: "2", name: "High" },
          ],
        },
      }),
    ).toEqual({
      issueIdOrKey: "ABC-123",
      assignee: { editable: true, required: false },
      priority: {
        editable: true,
        required: true,
        allowedValues: [
          { id: "1", name: "Highest" },
          { id: "2", name: "High" },
        ],
      },
    });
  });

  it("decodes transition metadata with supported and unsupported fields", () => {
    expect(decodeListIssueTransitionsInput({ issueIdOrKey: " ABC-123 " })).toEqual({
      issueIdOrKey: "ABC-123",
    });
    const result = decodeListIssueTransitionsResult({
      issueIdOrKey: "ABC-123",
      transitions: [
        {
          id: "31",
          name: "Resolve",
          to: { id: "10001", name: "Done", category: "done" },
          hasScreen: true,
          fields: [
            {
              id: "resolution",
              name: "Resolution",
              required: true,
              supported: true,
              schemaType: "resolution",
              allowedValues: [{ id: "10000", name: "Fixed" }],
            },
            {
              id: "customfield_10010",
              name: "Linked issue",
              required: true,
              supported: false,
              schemaType: "array",
              allowedValues: [],
            },
          ],
          unsupportedRequiredFieldIds: ["customfield_10010"],
        },
      ],
    });
    expect(result.transitions[0]?.fields[0]?.id).toBe("resolution");
    expect(result.transitions[0]?.unsupportedRequiredFieldIds).toEqual(["customfield_10010"]);
  });

  it("decodes assignable-user search inputs and results", () => {
    expect(
      decodeSearchAssignableUsersInput({
        issueIdOrKey: " ABC-123 ",
        query: " ada ",
        maxResults: 10,
      }),
    ).toEqual({ issueIdOrKey: "ABC-123", query: " ada ", maxResults: 10 });
    expect(decodeSearchAssignableUsersInput({ issueIdOrKey: "ABC-123", query: "" })).toEqual({
      issueIdOrKey: "ABC-123",
      query: "",
    });
    expect(() =>
      decodeSearchAssignableUsersInput({ issueIdOrKey: "ABC-123", query: "ada", maxResults: 0 }),
    ).toThrow();
    expect(
      decodeSearchAssignableUsersResult({
        users: [
          {
            accountId: " account-1 ",
            displayName: " Ada Lovelace ",
            emailAddress: null,
            avatarUrl: null,
          },
        ],
      }),
    ).toEqual({
      users: [
        {
          accountId: "account-1",
          displayName: "Ada Lovelace",
          emailAddress: null,
          avatarUrl: null,
        },
      ],
    });
  });

  it("decodes Jira issue mutation inputs and results", () => {
    expect(decodeAssignIssueInput({ issueIdOrKey: " ABC-123 ", accountId: " account-1 " })).toEqual(
      {
        issueIdOrKey: "ABC-123",
        accountId: "account-1",
      },
    );
    expect(decodeAssignIssueInput({ issueIdOrKey: "ABC-123", accountId: null })).toEqual({
      issueIdOrKey: "ABC-123",
      accountId: null,
    });
    expect(decodeUpdateIssueFieldsInput({ issueIdOrKey: "ABC-123", priorityId: " 2 " })).toEqual({
      issueIdOrKey: "ABC-123",
      priorityId: "2",
    });
    expect(decodeUpdateIssueFieldsInput({ issueIdOrKey: "ABC-123", priorityId: null })).toEqual({
      issueIdOrKey: "ABC-123",
      priorityId: null,
    });
    expect(
      decodeTransitionIssueInput({
        issueIdOrKey: " ABC-123 ",
        transitionId: " 31 ",
        fields: {
          resolutionId: " 10000 ",
          assigneeAccountId: null,
          priorityId: "2",
        },
      }),
    ).toEqual({
      issueIdOrKey: "ABC-123",
      transitionId: "31",
      fields: {
        resolutionId: "10000",
        assigneeAccountId: null,
        priorityId: "2",
      },
    });
    expect(decodeIssueMutationResult({ ok: true })).toEqual({ ok: true });
  });

  it("decodes and encodes Jira result shapes", () => {
    const list = decodeListIssuesResult({
      issues: [sampleIssue, { ...sampleIssue, key: "HELP-1", projectTypeKey: "service_desk" }],
      nextPageToken: "next-token",
    });
    expect(list.issues[0]?.key).toBe(JiraIssueKey.make("ABC-123"));
    expect(list.issues[0]?.projectTypeKey).toBeNull();
    // projectTypeKey rides on the summary so a ticket's client-facing status is
    // known straight from the list, without a detail fetch.
    expect(list.issues[1]?.projectTypeKey).toBe("service_desk");
    expect(isJiraServiceDeskProjectType(list.issues[1]?.projectTypeKey)).toBe(true);
    expect(encodeListIssuesResult(list).nextPageToken).toBe("next-token");

    const mentions = decodeSearchIssueMentionsResult({
      issues: [{ ...sampleIssue, reporter: undefined }],
    });
    expect(mentions.issues).toHaveLength(1);

    const validation = decodeValidateConnectionResult({
      ok: true,
      siteUrl: " https://example.atlassian.net ",
      accountId: null,
      displayName: " Ada Lovelace ",
    });
    expect(validation).toEqual({
      ok: true,
      siteUrl: "https://example.atlassian.net",
      accountId: null,
      displayName: "Ada Lovelace",
    });
  });

  it("decodes and encodes ADF documents and comments", () => {
    const adf = decodeAdfDocument(sampleAdf);
    expect(adf.type).toBe("doc");
    expect(adf.content).toHaveLength(1);
    expect(encodeAdfDocument(adf)).toEqual(sampleAdf);

    const comment = decodeComment(sampleComment);
    expect(comment.id).toBe("10100");
    expect(comment.author.displayName).toBe("Ada Lovelace");
    expect(comment.visibility).toBeNull();
    expect(comment.jsdPublic).toBeNull();
    expect(encodeComment(comment)).toEqual(sampleComment);

    const restricted = decodeComment({
      ...sampleComment,
      visibility: { type: "role", value: "Administrators" },
    });
    expect(restricted.visibility).toEqual({ type: "role", value: "Administrators" });

    // Service-desk comments carry the customer/internal flag.
    expect(decodeComment({ ...sampleComment, jsdPublic: true }).jsdPublic).toBe(true);
    expect(decodeComment({ ...sampleComment, jsdPublic: false }).jsdPublic).toBe(false);
  });

  it("decodes an issue description with embedded media resolutions", () => {
    const detail = decodeIssueDetail({
      ...sampleIssue,
      description: {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "See screenshot:" }] },
          {
            type: "mediaSingle",
            content: [{ type: "media", attrs: { id: "1234abcd-uuid", type: "file" } }],
          },
        ],
      },
      descriptionMediaResolutions: {
        "1234abcd-uuid": {
          contentUrl: "/api/jira-attachment/content/10042",
          thumbnailUrl: "/api/jira-attachment/thumbnail/10042",
          filename: "screenshot.png",
          mimeType: "image/png",
        },
      },
    });
    expect(detail.description?.content).toHaveLength(2);
    expect(detail.descriptionMediaResolutions?.["1234abcd-uuid"]?.filename).toBe("screenshot.png");
    // Issues without a description carry null and omit the resolutions key.
    const plain = decodeIssueDetail(sampleIssue);
    expect(plain.description).toBeNull();
    expect(plain.descriptionMediaResolutions).toBeUndefined();
  });

  it("decodes service-desk issue details and detects the project type", () => {
    const serviceDesk = decodeIssueDetail({ ...sampleIssue, projectTypeKey: "service_desk" });
    expect(serviceDesk.projectTypeKey).toBe("service_desk");
    expect(isJiraServiceDeskProjectType(serviceDesk.projectTypeKey)).toBe(true);

    expect(decodeIssueDetail(sampleIssue).projectTypeKey).toBeNull();
    expect(isJiraServiceDeskProjectType("software")).toBe(false);
    expect(isJiraServiceDeskProjectType(null)).toBe(false);
    expect(isJiraServiceDeskProjectType(undefined)).toBe(false);
  });

  it("decodes comment list, add, update, and delete inputs", () => {
    expect(
      decodeListCommentsInput({
        issueIdOrKey: " ABC-123 ",
        startAt: 25,
        maxResults: 50,
        orderBy: "-created",
      }),
    ).toEqual({ issueIdOrKey: "ABC-123", startAt: 25, maxResults: 50, orderBy: "-created" });
    expect(decodeListCommentsInput({ issueIdOrKey: "ABC-123" })).toEqual({
      issueIdOrKey: "ABC-123",
    });
    expect(decodeAddCommentInput({ issueIdOrKey: "ABC-123", body: sampleAdf })).toEqual({
      issueIdOrKey: "ABC-123",
      body: sampleAdf,
    });
    expect(
      decodeAddCommentInput({ issueIdOrKey: "ABC-123", body: sampleAdf, audience: "internal" }),
    ).toEqual({ issueIdOrKey: "ABC-123", body: sampleAdf, audience: "internal" });
    expect(() =>
      decodeAddCommentInput({ issueIdOrKey: "ABC-123", body: sampleAdf, audience: "everyone" }),
    ).toThrow();
    expect(
      decodeUpdateCommentInput({
        issueIdOrKey: "ABC-123",
        commentId: "10100",
        body: sampleAdf,
        visibility: { type: "role", value: "Administrators" },
        audience: "public",
      }),
    ).toEqual({
      issueIdOrKey: "ABC-123",
      commentId: "10100",
      body: sampleAdf,
      visibility: { type: "role", value: "Administrators" },
      audience: "public",
    });
    expect(decodeDeleteCommentInput({ issueIdOrKey: "ABC-123", commentId: "10100" })).toEqual({
      issueIdOrKey: "ABC-123",
      commentId: "10100",
    });
    expect(decodeDeleteCommentResult({ ok: true })).toEqual({ ok: true });
  });

  it("rejects invalid comment pagination and malformed ADF", () => {
    expect(() => decodeListCommentsInput({ issueIdOrKey: "ABC-123", maxResults: 101 })).toThrow();
    expect(() => decodeListCommentsInput({ issueIdOrKey: "ABC-123", startAt: -1 })).toThrow();
    expect(() =>
      decodeListCommentsInput({ issueIdOrKey: "ABC-123", orderBy: "updated" }),
    ).toThrow();
    expect(() => decodeAdfDocument({ type: "paragraph", version: 1, content: [] })).toThrow();
  });

  it("decodes and encodes Jira attachments and comments carrying media resolutions", () => {
    const attachment = decodeAttachment({
      restId: " 10042 ",
      mediaId: " 1234abcd-uuid ",
      filename: "diagram.png",
      mimeType: "image/png",
      size: 2048,
      thumbnailUrl: "/api/jira-attachment/thumbnail/10042",
      contentUrl: "/api/jira-attachment/content/10042",
    });
    expect(attachment.restId).toBe("10042");
    expect(attachment.mediaId).toBe("1234abcd-uuid");
    expect(encodeAttachment(attachment).contentUrl).toBe("/api/jira-attachment/content/10042");

    const unresolved = decodeAttachment({
      restId: "10043",
      mediaId: null,
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 12,
      thumbnailUrl: null,
      contentUrl: "/api/jira-attachment/content/10043",
    });
    expect(unresolved.mediaId).toBeNull();
    expect(unresolved.thumbnailUrl).toBeNull();

    const withMedia = decodeComment({
      ...sampleComment,
      mediaResolutions: {
        "1234abcd-uuid": {
          contentUrl: "/api/jira-attachment/content/10042",
          thumbnailUrl: "/api/jira-attachment/thumbnail/10042",
          filename: "diagram.png",
          mimeType: "image/png",
        },
      },
    });
    expect(withMedia.mediaResolutions?.["1234abcd-uuid"]?.filename).toBe("diagram.png");
    // Comments without media omit the key entirely and round-trip unchanged.
    expect(encodeComment(decodeComment(sampleComment))).toEqual(sampleComment);
  });

  it("decodes Jira upload attachment input", () => {
    expect(
      decodeUploadAttachmentInput({
        issueIdOrKey: " ABC-123 ",
        filename: " diagram.png ",
        mimeType: "image/png",
        contentBase64: "aGVsbG8=",
      }),
    ).toEqual({
      issueIdOrKey: "ABC-123",
      filename: "diagram.png",
      mimeType: "image/png",
      contentBase64: "aGVsbG8=",
    });
  });

  it("decodes Jira integration errors", () => {
    const error = decodeJiraIntegrationError({
      _tag: "JiraIntegrationError",
      reason: "unauthorized",
      status: 401,
      message: " Invalid Jira email or API token. ",
    });

    expect(error.reason).toBe("unauthorized");
    expect(error.status).toBe(401);
    expect(error.message).toBe("Invalid Jira email or API token.");
  });
});

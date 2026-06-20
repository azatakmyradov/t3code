import { it } from "@effect/vitest";
import {
  EnvironmentId,
  JiraIntegrationError,
  JiraIssueKey,
  ProviderInstanceId,
  ThreadId,
  type JiraIssueDetail,
  type JiraListCommentsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { afterEach, expect, vi } from "vite-plus/test";

import { JiraApi, type JiraApiShape } from "../../../fork/jira/index.ts";
import * as JiraToolAccess from "../../JiraToolAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { JiraToolkitHandlersLive } from "./handlers.ts";
import { JiraToolkit } from "./tools.ts";

const isJiraIntegrationError = Schema.is(JiraIntegrationError);

const threadId = ThreadId.make("thread-jira-test");
const baseInvocation = {
  environmentId: EnvironmentId.make("env-jira-test"),
  threadId,
  providerSessionId: "provider-session-jira-test",
  providerInstanceId: ProviderInstanceId.make("claude"),
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

afterEach(() => {
  JiraToolAccess.clearAllJiraToolAccess();
});

const issueDetail: JiraIssueDetail = {
  id: "10001",
  key: JiraIssueKey.make("ABC-123"),
  summary: "Fix deployment",
  status: { name: "In Progress", category: "indeterminate" },
  assignee: null,
  reporter: null,
  priority: "High",
  priorityId: "2",
  type: "Bug",
  project: "Platform",
  projectTypeKey: null,
  updated: "2026-01-02T03:04:05.000+0000",
  url: "https://example.atlassian.net/browse/ABC-123",
  description: { type: "doc", version: 1, content: [] },
};

const commentsResult: JiraListCommentsResult = {
  comments: [],
  startAt: 0,
  maxResults: 25,
  total: 0,
  isLast: true,
};

function makeJira(overrides: Partial<JiraApiShape>): JiraApiShape {
  const unsupported = () => Effect.die(new Error("Unexpected Jira API call")) as never;
  return {
    listIssues: unsupported,
    searchIssueMentions: unsupported,
    searchUserMentions: unsupported,
    getIssue: unsupported,
    getIssueEditMetadata: unsupported,
    listIssueTransitions: unsupported,
    searchAssignableUsers: unsupported,
    assignIssue: unsupported,
    updateIssueFields: unsupported,
    transitionIssue: unsupported,
    validateConnection: unsupported,
    listComments: unsupported,
    addComment: unsupported,
    updateComment: unsupported,
    deleteComment: unsupported,
    uploadAttachment: unsupported,
    ...overrides,
  };
}

const runHandle = <Name extends keyof typeof JiraToolkit.tools>(input: {
  readonly name: Name;
  readonly params: unknown;
  readonly capabilities: ReadonlyArray<"preview" | "jira">;
  readonly jira: JiraApiShape;
  readonly threadReferenced?: boolean;
}) =>
  Effect.sync(() => {
    if (input.threadReferenced !== false) {
      JiraToolAccess.markThreadJiraReferenced(threadId);
    }
  }).pipe(
    Effect.andThen(
      JiraToolkit.pipe(
        Effect.flatMap((built) =>
          Stream.unwrap(built.handle(input.name, input.params as never)).pipe(Stream.runHead),
        ),
        Effect.provide(JiraToolkitHandlersLive),
        Effect.provideService(JiraApi, input.jira),
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...baseInvocation,
          capabilities: new Set(input.capabilities),
        }),
      ),
    ),
  );

it.effect("jira_get_issue calls JiraApi.getIssue and returns the detail", () =>
  Effect.gen(function* () {
    const getIssue = vi.fn<JiraApiShape["getIssue"]>(() => Effect.succeed(issueDetail));
    const head = yield* runHandle({
      name: "jira_get_issue",
      params: { issueIdOrKey: "ABC-123" },
      capabilities: ["preview", "jira"],
      jira: makeJira({ getIssue }),
    });

    expect(getIssue).toHaveBeenCalledWith({ issueIdOrKey: "ABC-123" });
    expect(head._tag).toBe("Some");
    if (head._tag === "Some") {
      expect(head.value.isFailure).toBe(false);
      expect(head.value.result).toMatchObject({ key: "ABC-123", summary: "Fix deployment" });
    }
  }),
);

it.effect("jira_list_comments calls JiraApi.listComments with paging input", () =>
  Effect.gen(function* () {
    const listComments = vi.fn<JiraApiShape["listComments"]>(() => Effect.succeed(commentsResult));
    yield* runHandle({
      name: "jira_list_comments",
      params: { issueIdOrKey: "ABC-123", startAt: 5, maxResults: 50, orderBy: "-created" },
      capabilities: ["preview", "jira"],
      jira: makeJira({ listComments }),
    });

    expect(listComments).toHaveBeenCalledWith({
      issueIdOrKey: "ABC-123",
      startAt: 5,
      maxResults: 50,
      orderBy: "-created",
    });
  }),
);

it.effect("surfaces a JiraIntegrationError raised by JiraApi", () =>
  Effect.gen(function* () {
    const failure = new JiraIntegrationError({ reason: "not_configured", message: "Jira is not configured." });
    const error = yield* runHandle({
      name: "jira_get_issue",
      params: { issueIdOrKey: "ABC-123" },
      capabilities: ["preview", "jira"],
      jira: makeJira({ getIssue: () => Effect.fail(failure) }),
    }).pipe(Effect.flip);

    expect(isJiraIntegrationError(error)).toBe(true);
    expect(isJiraIntegrationError(error) ? error.reason : null).toBe("not_configured");
  }),
);

it.effect("blocks the tools until the thread has referenced a Jira ticket", () =>
  Effect.gen(function* () {
    const getIssue = vi.fn<JiraApiShape["getIssue"]>(() => Effect.succeed(issueDetail));
    const error = yield* runHandle({
      name: "jira_get_issue",
      params: { issueIdOrKey: "ABC-123" },
      capabilities: ["preview", "jira"],
      jira: makeJira({ getIssue }),
      threadReferenced: false,
    }).pipe(Effect.flip);

    expect(isJiraIntegrationError(error)).toBe(true);
    expect(isJiraIntegrationError(error) ? error.reason : null).toBe("forbidden");
    expect(getIssue).not.toHaveBeenCalled();
  }),
);

it.effect("maps a missing jira capability to a JiraIntegrationError", () =>
  Effect.gen(function* () {
    const getIssue = vi.fn<JiraApiShape["getIssue"]>(() => Effect.succeed(issueDetail));
    const error = yield* runHandle({
      name: "jira_get_issue",
      params: { issueIdOrKey: "ABC-123" },
      capabilities: ["preview"],
      jira: makeJira({ getIssue }),
    }).pipe(Effect.flip);

    expect(isJiraIntegrationError(error)).toBe(true);
    expect(isJiraIntegrationError(error) ? error.reason : null).toBe("forbidden");
    expect(getIssue).not.toHaveBeenCalled();
  }),
);

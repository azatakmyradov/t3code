import { assert, it, vi } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  JiraIntegrationError,
  JiraIssueKey,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerSettingsService } from "../../serverSettings.ts";
import * as JiraApi from "./JiraApi.ts";

const textDecoder = new TextDecoder();

const configuredSettings: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  fork: {
    ...DEFAULT_SERVER_SETTINGS.fork,
    jira: {
      siteUrl: "https://example.atlassian.net/",
      email: "ada@example.com",
      apiToken: "jira-token",
    },
  },
};

function makeLayer(input: {
  readonly settings?: ServerSettings;
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );
  const layer = JiraApi.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => execute(request)),
      ),
    ),
    Layer.provide(ServerSettingsService.layerTest(input.settings ?? configuredSettings)),
  );

  return { execute, layer };
}

function requestJson(request: HttpClientRequest.HttpClientRequest): unknown {
  const rawBody = (request.body as { readonly body?: Uint8Array }).body;
  assert.ok(rawBody);
  return JSON.parse(textDecoder.decode(rawBody));
}

function issueJson(key = "ABC-123") {
  return {
    id: "10001",
    key,
    fields: {
      summary: "Fix deployment",
      status: { name: "In Progress", statusCategory: { name: "indeterminate" } },
      assignee: {
        accountId: "assignee-account",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
        avatarUrls: { "48x48": "https://example.atlassian.net/avatar.png" },
      },
      reporter: {
        accountId: "reporter-account",
        displayName: "Grace Hopper",
      },
      priority: { id: "2", name: "High" },
      issuetype: { name: "Bug" },
      project: { name: "Platform", key: "ABC" },
      updated: "2026-01-02T03:04:05.000+0000",
    },
  };
}

it.effect("uses Basic auth and lists Jira issues through /search/jql", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        issues: [issueJson()],
        nextPageToken: "next-token",
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listIssues({
      jql: "project = ABC ORDER BY updated DESC",
      maxResults: 20,
      nextPageToken: "page-token",
    });

    assert.deepStrictEqual(result, {
      issues: [
        {
          id: "10001",
          key: JiraIssueKey.make("ABC-123"),
          summary: "Fix deployment",
          status: { name: "In Progress", category: "indeterminate" },
          assignee: {
            accountId: "assignee-account",
            displayName: "Ada Lovelace",
            emailAddress: "ada@example.com",
            avatarUrl: "https://example.atlassian.net/avatar.png",
          },
          priority: "High",
          priorityId: "2",
          type: "Bug",
          project: "Platform",
          projectTypeKey: null,
          updated: "2026-01-02T03:04:05.000+0000",
          url: "https://example.atlassian.net/browse/ABC-123",
        },
      ],
      nextPageToken: "next-token",
    });

    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/search/jql");
    assert.equal(request.method, "POST");
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from("ada@example.com:jira-token").toString("base64")}`,
    );
    assert.deepStrictEqual(requestJson(request), {
      jql: "project = ABC ORDER BY updated DESC",
      maxResults: 20,
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
      nextPageToken: "page-token",
    });
  }).pipe(Effect.provide(layer));
});

it.effect("surfaces projectTypeKey on listed issue summaries", () => {
  const serviceDeskIssue = {
    ...issueJson("HELP-1"),
    fields: {
      ...issueJson("HELP-1").fields,
      project: { name: "Help Center", key: "HELP", projectTypeKey: "service_desk" },
    },
  };
  const { layer } = makeLayer({
    response: () => Response.json({ issues: [serviceDeskIssue], nextPageToken: null }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listIssues({});
    assert.equal(result.issues[0]?.projectTypeKey, "service_desk");
  }).pipe(Effect.provide(layer));
});

it.effect("searches Jira mentions through /issue/picker", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        sections: [
          {
            issues: [
              {
                id: "10002",
                key: "ABC-456",
                summaryText: "<b>Fix</b> picker result",
              },
            ],
          },
        ],
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.searchIssueMentions({
      query: "ABC",
      currentJQL: "project = ABC",
      limit: 5,
    });

    assert.equal(result.issues[0]?.key, JiraIssueKey.make("ABC-456"));
    assert.equal(result.issues[0]?.summary, "Fix picker result");

    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/picker");
    assert.deepStrictEqual(request.urlParams.params, [
      ["query", "ABC"],
      ["currentJQL", "project = ABC"],
      ["showSubTasks", "true"],
      ["showSubTaskParent", "true"],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("uses the broad fallback issue search for empty mention queries", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        issues: [issueJson("ABC-789")],
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.searchIssueMentions({ query: "", limit: 10 });

    assert.equal(result.issues[0]?.key, JiraIssueKey.make("ABC-789"));
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/search/jql");
    assert.deepInclude(requestJson(request) as Record<string, unknown>, {
      jql: 'created >= "1970-01-01" ORDER BY updated DESC',
      maxResults: 10,
    });
  }).pipe(Effect.provide(layer));
});

it.effect("searches mentionable users through /user/search", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json([
        {
          accountId: "user-account",
          displayName: "Ada Lovelace",
          emailAddress: "ada@example.com",
          avatarUrls: { "48x48": "https://example.atlassian.net/avatar.png" },
        },
        // App/automation accounts without an accountId cannot be mentioned.
        { displayName: "No Account" },
      ]),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.searchUserMentions({ query: "ada", limit: 5 });

    assert.deepStrictEqual(result.users, [
      {
        accountId: "user-account",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
        avatarUrl: "https://example.atlassian.net/avatar.png",
      },
    ]);

    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/user/search");
    assert.deepStrictEqual(request.urlParams.params, [
      ["query", "ada"],
      ["maxResults", "5"],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("returns no users for an empty mention query without calling Jira", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json([]),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.searchUserMentions({ query: "   " });

    assert.deepStrictEqual(result, { users: [] });
    // Jira rejects an empty query, so we must not issue the request at all.
    assert.equal(execute.mock.calls.length, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("loads Jira issue details through /issue/{issueIdOrKey}", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json(issueJson("ABC-123")),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const detail = yield* jira.getIssue({ issueIdOrKey: "ABC-123" });

    assert.equal(detail.reporter?.displayName, "Grace Hopper");
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123");
    assert.deepStrictEqual(request.urlParams.params, [
      ["fields", "summary,status,assignee,reporter,priority,issuetype,project,updated,description"],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("fetches edit metadata and normalizes priority options", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        fields: {
          assignee: {
            required: false,
            name: "Assignee",
            schema: { type: "user" },
          },
          priority: {
            required: true,
            name: "Priority",
            schema: { type: "priority" },
            allowedValues: [
              { id: "1", name: "Highest" },
              { id: "2", name: "High" },
            ],
          },
        },
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const metadata = yield* jira.getIssueEditMetadata({ issueIdOrKey: "ABC-123" });

    assert.deepStrictEqual(metadata, {
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
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123/editmeta");
  }).pipe(Effect.provide(layer));
});

it.effect("lists transitions with required resolution fields", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        transitions: [
          {
            id: "31",
            name: "Resolve issue",
            to: {
              id: "10001",
              name: "Done",
              statusCategory: { key: "done", name: "Done" },
            },
            hasScreen: true,
            fields: {
              resolution: {
                required: true,
                name: "Resolution",
                schema: { type: "resolution" },
                allowedValues: [{ id: "10000", name: "Fixed" }],
              },
            },
          },
        ],
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listIssueTransitions({ issueIdOrKey: "ABC-123" });

    assert.deepStrictEqual(result, {
      issueIdOrKey: "ABC-123",
      transitions: [
        {
          id: "31",
          name: "Resolve issue",
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
          ],
          unsupportedRequiredFieldIds: [],
        },
      ],
    });
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123/transitions");
    assert.deepStrictEqual(request.urlParams.params, [
      ["expand", "transitions.fields"],
      ["sortByOpsBarAndStatus", "true"],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("marks unsupported required transition fields", () => {
  const { layer } = makeLayer({
    response: () =>
      Response.json({
        transitions: [
          {
            id: "41",
            name: "Escalate",
            to: { id: "10002", name: "Escalated", statusCategory: { name: "In Progress" } },
            hasScreen: true,
            fields: {
              customfield_10010: {
                required: true,
                name: "Linked request",
                schema: { type: "array" },
                allowedValues: [],
              },
            },
          },
        ],
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listIssueTransitions({ issueIdOrKey: "ABC-123" });
    const transition = result.transitions[0];
    assert.ok(transition);
    assert.deepStrictEqual(transition.unsupportedRequiredFieldIds, ["customfield_10010"]);
    assert.equal(transition.fields[0]?.supported, false);
  }).pipe(Effect.provide(layer));
});

it.effect("searches assignable users with issueKey", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json([
        {
          accountId: "assignee-account",
          displayName: "Ada Lovelace",
          emailAddress: "ada@example.com",
          avatarUrls: { "48x48": "https://example.atlassian.net/avatar.png" },
        },
      ]),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.searchAssignableUsers({
      issueIdOrKey: "ABC-123",
      query: "ada",
      maxResults: 5,
    });

    assert.deepStrictEqual(result.users, [
      {
        accountId: "assignee-account",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
        avatarUrl: "https://example.atlassian.net/avatar.png",
      },
    ]);
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/user/assignable/search");
    assert.deepStrictEqual(request.urlParams.params, [
      ["issueKey", "ABC-123"],
      ["query", "ada"],
      ["maxResults", "5"],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("assigns and unassigns Jira issues", () =>
  Effect.gen(function* () {
    for (const accountId of ["assignee-account", null] as const) {
      const { execute, layer } = makeLayer({
        response: () => new Response(null, { status: 204 }),
      });
      yield* Effect.gen(function* () {
        const jira = yield* JiraApi.JiraApi;
        const result = yield* jira.assignIssue({ issueIdOrKey: "ABC-123", accountId });
        assert.deepStrictEqual(result, { ok: true });
        const request = execute.mock.calls[0]?.[0];
        assert.ok(request);
        assert.equal(
          request.url,
          "https://example.atlassian.net/rest/api/3/issue/ABC-123/assignee",
        );
        assert.equal(request.method, "PUT");
        assert.deepStrictEqual(requestJson(request), { accountId });
      }).pipe(Effect.provide(layer));
    }
  }),
);

it.effect("updates priority through edit issue", () => {
  const { execute, layer } = makeLayer({
    response: () => new Response(null, { status: 204 }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.updateIssueFields({ issueIdOrKey: "ABC-123", priorityId: "2" });

    assert.deepStrictEqual(result, { ok: true });
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123");
    assert.equal(request.method, "PUT");
    assert.deepStrictEqual(requestJson(request), { fields: { priority: { id: "2" } } });
  }).pipe(Effect.provide(layer));
});

it.effect("transitions an issue with resolution", () => {
  const { execute, layer } = makeLayer({
    response: () => new Response(null, { status: 204 }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.transitionIssue({
      issueIdOrKey: "ABC-123",
      transitionId: "31",
      fields: { resolutionId: "10000" },
    });

    assert.deepStrictEqual(result, { ok: true });
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123/transitions");
    assert.equal(request.method, "POST");
    assert.deepStrictEqual(requestJson(request), {
      transition: { id: "31" },
      fields: { resolution: { id: "10000" } },
    });
  }).pipe(Effect.provide(layer));
});

it.effect("maps issue mutation failures through Jira error handling", () => {
  const responses = [
    { status: 401, reason: "unauthorized", message: "Invalid Jira email or API token." },
    { status: 403, reason: "forbidden", message: "Jira permissions do not allow this request." },
    {
      status: 429,
      reason: "rate_limited",
      message: "Jira rate limit reached. Try again in a moment.",
    },
    { status: 500, reason: "http_error", message: "Jira returned HTTP 500: Jira exploded" },
  ] as const;

  return Effect.gen(function* () {
    for (const response of responses) {
      const { layer } = makeLayer({
        response: () =>
          Response.json({ errorMessages: ["Jira exploded"] }, { status: response.status }),
      });
      const error = yield* Effect.gen(function* () {
        const jira = yield* JiraApi.JiraApi;
        return yield* Effect.flip(
          jira.updateIssueFields({ issueIdOrKey: "ABC-123", priorityId: "2" }),
        );
      }).pipe(Effect.provide(layer));

      assert.instanceOf(error, JiraIntegrationError);
      assert.equal(error.reason, response.reason);
      assert.equal(error.status, response.status);
      assert.equal(error.message, response.message);
    }
  });
});

it.effect("validates Jira credentials through /myself", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        accountId: "account-123",
        displayName: "Ada Lovelace",
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.validateConnection({
      siteUrl: "https://example.atlassian.net/",
      email: "ada@example.com",
      apiToken: "jira-token",
    });

    assert.deepStrictEqual(result, {
      ok: true,
      siteUrl: "https://example.atlassian.net",
      accountId: "account-123",
      displayName: "Ada Lovelace",
    });
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/myself");
  }).pipe(Effect.provide(layer));
});

function commentJson(id = "10100") {
  return {
    id,
    author: {
      accountId: "author-account",
      displayName: "Ada Lovelace",
      emailAddress: "ada@example.com",
      avatarUrls: { "48x48": "https://example.atlassian.net/avatar.png" },
    },
    updateAuthor: {
      accountId: "editor-account",
      displayName: "Grace Hopper",
    },
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Looks good" },
            { type: "hardBreak" },
            { type: "text", text: "ship it" },
          ],
        },
      ],
    },
    created: "2026-01-02T03:04:05.000+0000",
    updated: "2026-01-03T03:04:05.000+0000",
    visibility: { type: "role", value: "Administrators", identifier: "admin" },
  };
}

it.effect("lists Jira comments through /comment with pagination", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        comments: [commentJson()],
        startAt: 0,
        maxResults: 25,
        total: 1,
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listComments({
      issueIdOrKey: "ABC-123",
      startAt: 0,
      maxResults: 25,
      orderBy: "-created",
    });

    assert.equal(result.total, 1);
    assert.equal(result.isLast, true);
    assert.equal(result.comments.length, 1);
    const comment = result.comments[0];
    assert.ok(comment);
    assert.equal(comment.id, "10100");
    assert.equal(comment.issueIdOrKey, "ABC-123");
    assert.equal(comment.author.displayName, "Ada Lovelace");
    assert.equal(comment.updateAuthor?.displayName, "Grace Hopper");
    assert.equal(comment.plainText, "Looks good\nship it");
    assert.equal(comment.created, "2026-01-02T03:04:05.000+0000");
    assert.deepStrictEqual(comment.visibility, {
      type: "role",
      value: "Administrators",
      identifier: "admin",
    });
    assert.equal(
      comment.url,
      "https://example.atlassian.net/browse/ABC-123?focusedCommentId=10100",
    );

    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123/comment");
    assert.equal(request.method, "GET");
    assert.deepStrictEqual(request.urlParams.params, [
      ["startAt", "0"],
      ["maxResults", "25"],
      ["orderBy", "-created"],
      ["expand", "renderedBody"],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("adds a Jira comment with an ADF body", () => {
  const body = {
    type: "doc" as const,
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "New comment" }] }],
  };
  const { execute, layer } = makeLayer({
    response: () => Response.json(commentJson("10200")),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const comment = yield* jira.addComment({ issueIdOrKey: "ABC-123", body });

    assert.equal(comment.id, "10200");
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issue/ABC-123/comment");
    assert.equal(request.method, "POST");
    assert.deepStrictEqual(requestJson(request), { body });
  }).pipe(Effect.provide(layer));
});

it.effect("posts the sd.public.comment property for service-desk reply audiences", () => {
  const body = {
    type: "doc" as const,
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Reply" }] }],
  };

  return Effect.gen(function* () {
    for (const audience of ["internal", "public"] as const) {
      const { execute, layer } = makeLayer({
        response: () => Response.json(commentJson("10201")),
      });
      yield* Effect.gen(function* () {
        const jira = yield* JiraApi.JiraApi;
        yield* jira.addComment({ issueIdOrKey: "ABC-123", body, audience });
        const request = execute.mock.calls[0]?.[0];
        assert.ok(request);
        assert.deepStrictEqual(requestJson(request), {
          body,
          properties: [{ key: "sd.public.comment", value: { internal: audience === "internal" } }],
        });
      }).pipe(Effect.provide(layer));
    }
  });
});

it.effect("re-asserts the audience property when updating a service-desk comment", () => {
  const body = {
    type: "doc" as const,
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Edited" }] }],
  };
  const { execute, layer } = makeLayer({
    response: () => Response.json(commentJson()),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    yield* jira.updateComment({
      issueIdOrKey: "ABC-123",
      commentId: "10100",
      body,
      audience: "internal",
    });
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.deepStrictEqual(requestJson(request), {
      body,
      properties: [{ key: "sd.public.comment", value: { internal: true } }],
    });
  }).pipe(Effect.provide(layer));
});

it.effect("updates a Jira comment and preserves visibility when passed", () => {
  const body = {
    type: "doc" as const,
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Edited" }] }],
  };
  const visibility = { type: "role", value: "Administrators" } as const;
  const { execute, layer } = makeLayer({
    response: () => Response.json(commentJson()),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    yield* jira.updateComment({
      issueIdOrKey: "ABC-123",
      commentId: "10100",
      body,
      visibility,
    });

    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(
      request.url,
      "https://example.atlassian.net/rest/api/3/issue/ABC-123/comment/10100",
    );
    assert.equal(request.method, "PUT");
    assert.deepStrictEqual(requestJson(request), { body, visibility });
  }).pipe(Effect.provide(layer));
});

it.effect("surfaces the jsdPublic customer/internal flag on listed comments", () => {
  const { layer } = makeLayer({
    response: () =>
      Response.json({
        comments: [
          { ...commentJson("10110"), jsdPublic: true },
          { ...commentJson("10111"), jsdPublic: false },
          commentJson("10112"),
        ],
        startAt: 0,
        maxResults: 25,
        total: 3,
      }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listComments({ issueIdOrKey: "ABC-123" });
    assert.equal(result.comments[0]?.jsdPublic, true);
    assert.equal(result.comments[1]?.jsdPublic, false);
    // Absent on the wire (non-service-desk projects omit it) normalizes to null.
    assert.equal(result.comments[2]?.jsdPublic, null);
  }).pipe(Effect.provide(layer));
});

it.effect("reports projectTypeKey so service-desk issues can be detected", () => {
  const serviceDeskIssue = {
    ...issueJson("HELP-1"),
    fields: {
      ...issueJson("HELP-1").fields,
      project: { name: "Help Center", key: "HELP", projectTypeKey: "service_desk" },
    },
  };
  const { layer } = makeLayer({
    response: () => Response.json(serviceDeskIssue),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const detail = yield* jira.getIssue({ issueIdOrKey: "HELP-1" });
    assert.equal(detail.projectTypeKey, "service_desk");
  }).pipe(Effect.provide(layer));
});

it.effect("leaves projectTypeKey null when Jira omits it", () => {
  const { layer } = makeLayer({
    response: () => Response.json(issueJson("ABC-123")),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const detail = yield* jira.getIssue({ issueIdOrKey: "ABC-123" });
    assert.equal(detail.projectTypeKey, null);
  }).pipe(Effect.provide(layer));
});

it.effect("deletes a Jira comment and maps 204 to ok", () => {
  const { execute, layer } = makeLayer({
    response: () => new Response(null, { status: 204 }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.deleteComment({ issueIdOrKey: "ABC-123", commentId: "10100" });

    assert.deepStrictEqual(result, { ok: true });
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    assert.equal(
      request.url,
      "https://example.atlassian.net/rest/api/3/issue/ABC-123/comment/10100",
    );
    assert.equal(request.method, "DELETE");
  }).pipe(Effect.provide(layer));
});

it.effect("maps comment delete failures through Jira error handling", () => {
  const { layer } = makeLayer({
    response: () => Response.json({ errorMessages: ["Nope"] }, { status: 403 }),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const error = yield* Effect.flip(
      jira.deleteComment({ issueIdOrKey: "ABC-123", commentId: "10100" }),
    );

    assert.instanceOf(error, JiraIntegrationError);
    assert.equal(error.reason, "forbidden");
    assert.equal(error.status, 403);
  }).pipe(Effect.provide(layer));
});

const MEDIA_UUID = "12345678-1234-1234-1234-1234567890ab";

function attachmentJson(id = "10042") {
  return {
    id,
    filename: "diagram.png",
    mimeType: "image/png",
    size: 2048,
    content: `https://example.atlassian.net/rest/api/3/attachment/content/${id}`,
    thumbnail: `https://example.atlassian.net/rest/api/3/attachment/thumbnail/${id}`,
  };
}

function mediaRedirectResponse() {
  return new Response(null, {
    status: 302,
    headers: { location: `https://media-api.atlassian.com/file/${MEDIA_UUID}/binary?token=x` },
  });
}

it.effect("uploads an attachment and resolves its media UUID via the redirect Location", () => {
  const { execute, layer } = makeLayer({
    response: (request) => {
      if (request.url.endsWith("/attachments")) {
        return Response.json([attachmentJson()]);
      }
      if (request.url.includes("/attachment/content/")) {
        return mediaRedirectResponse();
      }
      return Response.json({});
    },
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const attachment = yield* jira.uploadAttachment({
      issueIdOrKey: "ABC-123",
      filename: "diagram.png",
      mimeType: "image/png",
      contentBase64: Buffer.from("png-bytes").toString("base64"),
    });

    assert.deepStrictEqual(attachment, {
      restId: "10042",
      mediaId: MEDIA_UUID,
      filename: "diagram.png",
      mimeType: "image/png",
      size: 2048,
      thumbnailUrl: "/api/jira-attachment/thumbnail/10042",
      contentUrl: "/api/jira-attachment/content/10042",
    });

    const uploadRequest = execute.mock.calls[0]?.[0];
    assert.ok(uploadRequest);
    assert.equal(
      uploadRequest.url,
      "https://example.atlassian.net/rest/api/3/issue/ABC-123/attachments",
    );
    assert.equal(uploadRequest.method, "POST");
    assert.equal(uploadRequest.headers["x-atlassian-token"], "no-check");
  }).pipe(Effect.provide(layer));
});

it.effect("falls back to a null media UUID when the redirect carries no UUID", () => {
  const { layer } = makeLayer({
    response: (request) => {
      if (request.url.endsWith("/attachments")) {
        return Response.json([attachmentJson("10050")]);
      }
      if (request.url.includes("/attachment/content/")) {
        return new Response(null, { status: 200 });
      }
      return Response.json({});
    },
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const attachment = yield* jira.uploadAttachment({
      issueIdOrKey: "ABC-123",
      filename: "diagram.png",
      mimeType: "image/png",
      contentBase64: Buffer.from("png").toString("base64"),
    });
    assert.equal(attachment.mediaId, null);
    assert.equal(attachment.restId, "10050");
  }).pipe(Effect.provide(layer));
});

it.effect("enriches listed comments with media resolutions for referenced media nodes", () => {
  const commentWithMedia = {
    id: "10300",
    author: { accountId: "a", displayName: "Ada" },
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "mediaSingle",
          content: [{ type: "media", attrs: { id: MEDIA_UUID, type: "file" } }],
        },
      ],
    },
    created: "2026-01-02T03:04:05.000+0000",
    updated: "2026-01-02T03:04:05.000+0000",
  };
  const { execute, layer } = makeLayer({
    response: (request) => {
      if (request.url.endsWith("/comment")) {
        return Response.json({
          comments: [commentWithMedia],
          startAt: 0,
          maxResults: 25,
          total: 1,
        });
      }
      if (request.url.endsWith("/issue/ABC-123")) {
        return Response.json({ fields: { attachment: [attachmentJson()] } });
      }
      if (request.url.includes("/attachment/content/")) {
        return mediaRedirectResponse();
      }
      return Response.json({});
    },
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listComments({ issueIdOrKey: "ABC-123" });
    const comment = result.comments[0];
    assert.ok(comment);
    assert.deepStrictEqual(comment.mediaResolutions, {
      [MEDIA_UUID]: {
        contentUrl: "/api/jira-attachment/content/10042",
        thumbnailUrl: "/api/jira-attachment/thumbnail/10042",
        filename: "diagram.png",
        mimeType: "image/png",
      },
    });
    // The attachment list endpoint is consulted once for the page.
    const attachmentListCalls = execute.mock.calls.filter((call) =>
      call[0]?.url.endsWith("/issue/ABC-123"),
    );
    assert.equal(attachmentListCalls.length, 1);
  }).pipe(Effect.provide(layer));
});

it.effect("skips media enrichment when no comment references media", () => {
  const { execute, layer } = makeLayer({
    response: (request) => {
      if (request.url.endsWith("/comment")) {
        return Response.json({ comments: [commentJson()], startAt: 0, maxResults: 25, total: 1 });
      }
      return Response.json({});
    },
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const result = yield* jira.listComments({ issueIdOrKey: "ABC-123" });
    assert.equal(result.comments[0]?.mediaResolutions, undefined);
    // Only the comment list endpoint is hit; no attachment lookups occur.
    assert.equal(execute.mock.calls.length, 1);
  }).pipe(Effect.provide(layer));
});

it.effect("loads an issue description and enriches its referenced media nodes", () => {
  const descriptionWithMedia = {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "See screenshot" }] },
      {
        type: "mediaSingle",
        content: [{ type: "media", attrs: { id: MEDIA_UUID, type: "file" } }],
      },
    ],
  };
  const { layer } = makeLayer({
    // The issue-detail and attachment-list requests share the /issue/ABC-123 URL,
    // so they are told apart by their `fields` query param.
    response: (request) => {
      const fields = request.urlParams.params.find(([key]) => key === "fields")?.[1];
      if (request.url.endsWith("/issue/ABC-123") && fields === "attachment") {
        return Response.json({ fields: { attachment: [attachmentJson()] } });
      }
      if (request.url.endsWith("/issue/ABC-123")) {
        const base = issueJson("ABC-123");
        return Response.json({
          ...base,
          fields: { ...base.fields, description: descriptionWithMedia },
        });
      }
      if (request.url.includes("/attachment/content/")) {
        return mediaRedirectResponse();
      }
      return Response.json({});
    },
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const detail = yield* jira.getIssue({ issueIdOrKey: "ABC-123" });
    assert.equal(detail.description?.content.length, 2);
    assert.deepStrictEqual(detail.descriptionMediaResolutions, {
      [MEDIA_UUID]: {
        contentUrl: "/api/jira-attachment/content/10042",
        thumbnailUrl: "/api/jira-attachment/thumbnail/10042",
        filename: "diagram.png",
        mimeType: "image/png",
      },
    });
  }).pipe(Effect.provide(layer));
});

it.effect("leaves a description-less issue without media lookups", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json(issueJson("ABC-123")),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const detail = yield* jira.getIssue({ issueIdOrKey: "ABC-123" });
    assert.equal(detail.description, null);
    assert.equal(detail.descriptionMediaResolutions, undefined);
    // Only the issue-detail endpoint is hit; no attachment lookups occur.
    assert.equal(execute.mock.calls.length, 1);
  }).pipe(Effect.provide(layer));
});

it.effect("returns not_configured when Jira credentials are missing", () => {
  const { execute, layer } = makeLayer({
    settings: DEFAULT_SERVER_SETTINGS,
    response: () => Response.json({}),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const error = yield* Effect.flip(jira.listIssues({}));

    assert.equal(error.reason, "not_configured");
    assert.equal(error.message, "Jira is not configured.");
    assert.equal(execute.mock.calls.length, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("maps Jira HTTP failures to integration errors", () => {
  const responses = [
    { status: 401, reason: "unauthorized", message: "Invalid Jira email or API token." },
    { status: 403, reason: "forbidden", message: "Jira permissions do not allow this request." },
    {
      status: 429,
      reason: "rate_limited",
      message: "Jira rate limit reached. Try again in a moment.",
    },
    { status: 500, reason: "http_error", message: "Jira returned HTTP 500: Jira exploded" },
  ] as const;

  return Effect.gen(function* () {
    for (const response of responses) {
      const { layer } = makeLayer({
        response: () =>
          Response.json({ errorMessages: ["Jira exploded"] }, { status: response.status }),
      });
      const error = yield* Effect.gen(function* () {
        const jira = yield* JiraApi.JiraApi;
        return yield* Effect.flip(jira.listIssues({}));
      }).pipe(Effect.provide(layer));

      assert.instanceOf(error, JiraIntegrationError);
      assert.equal(error.reason, response.reason);
      assert.equal(error.status, response.status);
      assert.equal(error.message, response.message);
    }
  });
});

it.effect("rejects invalid Jira validation URLs before issuing a request", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json({}),
  });

  return Effect.gen(function* () {
    const jira = yield* JiraApi.JiraApi;
    const error = yield* Effect.flip(
      jira.validateConnection({
        siteUrl: "http://example.atlassian.net",
        email: "ada@example.com",
        apiToken: "jira-token",
      }),
    );

    assert.equal(error.reason, "invalid_config");
    assert.equal(execute.mock.calls.length, 0);
  }).pipe(Effect.provide(layer));
});

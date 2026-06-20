import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type JiraComment,
  type JiraIssueSummary,
  type JiraListCommentsResult,
  type JiraListIssuesResult,
  type JiraIssueUser,
  type JiraMentionUser,
  type ServerSettings,
  WS_METHODS,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentQuery } from "../../state/query";
import { isJiraConfigured } from "./jiraConfig";
import { buildAssignableUsersQueryInput } from "./jiraIssueFields";

const JIRA_LIST_PAGE_SIZE = 25;
const JIRA_COMMENTS_PAGE_SIZE = 25;
const JIRA_MENTION_LIMIT = 10;
const JIRA_MENTION_DEBOUNCE_MS = 160;
const JIRA_ASSIGNABLE_USER_LIMIT = 10;
const JIRA_ASSIGNABLE_USER_DEBOUNCE_MS = 180;
const EMPTY_ISSUES: ReadonlyArray<JiraIssueSummary> = [];
const EMPTY_USERS: ReadonlyArray<JiraMentionUser> = [];
const EMPTY_ASSIGNABLE_USERS: ReadonlyArray<JiraIssueUser> = [];

/**
 * JQL matching every accessible issue, most-recently-updated first. Used as a
 * safe broad fallback and by the comment `#` issue picker so any ticket can be
 * referenced, not just the dashboard list scope.
 *
 * The `created >= ...` clause is load-bearing: Jira's issue-picker `currentJQL`
 * (used for non-empty queries) requires a real filter clause and rejects a
 * sort-only `ORDER BY`, which would make every `#abc` search fail. Every issue
 * has a creation date after 1970, so this matches all of them.
 */
export const JIRA_ALL_ISSUES_JQL = 'created >= "1970-01-01" ORDER BY updated DESC';
const INITIAL_PAGE_TOKENS = [undefined] as const;
const INITIAL_COMMENT_OFFSETS = [0] as const;

export const jiraEnvironment = {
  listIssues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:list-issues",
    tag: WS_METHODS.jiraListIssues,
  }),
  searchIssueMentions: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:search-issue-mentions",
    tag: WS_METHODS.jiraSearchIssueMentions,
    staleTimeMs: 15_000,
  }),
  searchUserMentions: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:search-user-mentions",
    tag: WS_METHODS.jiraSearchUserMentions,
    staleTimeMs: 15_000,
  }),
  getIssue: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:get-issue",
    tag: WS_METHODS.jiraGetIssue,
  }),
  getIssueEditMetadata: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:get-issue-edit-metadata",
    tag: WS_METHODS.jiraGetIssueEditMetadata,
    staleTimeMs: 10_000,
  }),
  listIssueTransitions: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:list-issue-transitions",
    tag: WS_METHODS.jiraListIssueTransitions,
    staleTimeMs: 10_000,
  }),
  searchAssignableUsers: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:search-assignable-users",
    tag: WS_METHODS.jiraSearchAssignableUsers,
    staleTimeMs: 5_000,
  }),
  validateConnection: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:validate-connection",
    tag: WS_METHODS.jiraValidateConnection,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId }) => environmentId,
    },
  }),
  listComments: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:jira:list-comments",
    tag: WS_METHODS.jiraListComments,
  }),
  addComment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:add-comment",
    tag: WS_METHODS.jiraAddComment,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId, input }) => `${environmentId}:${input.issueIdOrKey}`,
    },
  }),
  updateComment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:update-comment",
    tag: WS_METHODS.jiraUpdateComment,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId, input }) =>
        `${environmentId}:${input.issueIdOrKey}:${input.commentId}`,
    },
  }),
  deleteComment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:delete-comment",
    tag: WS_METHODS.jiraDeleteComment,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId, input }) =>
        `${environmentId}:${input.issueIdOrKey}:${input.commentId}`,
    },
  }),
  uploadAttachment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:upload-attachment",
    tag: WS_METHODS.jiraUploadAttachment,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId, input }) => `${environmentId}:${input.issueIdOrKey}`,
    },
  }),
  assignIssue: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:assign-issue",
    tag: WS_METHODS.jiraAssignIssue,
    concurrency: {
      mode: "serial",
      key: ({ environmentId, input }) => `${environmentId}:${input.issueIdOrKey}`,
    },
  }),
  updateIssueFields: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:update-issue-fields",
    tag: WS_METHODS.jiraUpdateIssueFields,
    concurrency: {
      mode: "serial",
      key: ({ environmentId, input }) => `${environmentId}:${input.issueIdOrKey}`,
    },
  }),
  transitionIssue: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:jira:transition-issue",
    tag: WS_METHODS.jiraTransitionIssue,
    concurrency: {
      mode: "serial",
      key: ({ environmentId, input }) => `${environmentId}:${input.issueIdOrKey}`,
    },
  }),
};

function formatAsyncResultError(result: AsyncResult.AsyncResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure") return null;
  const error = Cause.squash(result.cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Jira request failed.";
}

export function useJiraIssuePages(input: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly jql: string;
}) {
  const configured = isJiraConfigured(input.settings);
  const jql = input.jql.trim() || JIRA_ALL_ISSUES_JQL;
  const targetKey =
    input.environmentId !== null && configured ? JSON.stringify([input.environmentId, jql]) : null;
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly tokens: ReadonlyArray<string | undefined>;
  }>({ targetKey, tokens: INITIAL_PAGE_TOKENS });
  const tokens = pagination.targetKey === targetKey ? pagination.tokens : INITIAL_PAGE_TOKENS;

  const pageAtoms = useMemo(
    () =>
      input.environmentId !== null && configured
        ? tokens.map((token) =>
            jiraEnvironment.listIssues({
              environmentId: input.environmentId!,
              input: {
                jql,
                maxResults: JIRA_LIST_PAGE_SIZE,
                ...(token === undefined ? {} : { nextPageToken: token }),
              },
            }),
          )
        : [],
    [configured, input.environmentId, jql, tokens],
  );
  const pagesAtom = useMemo(
    () =>
      Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
        Atom.withLabel(`web:jira-issue-pages:${targetKey ?? "empty"}`),
      ),
    [pageAtoms, targetKey],
  );
  const results = useAtomValue(pagesAtom);
  const pages = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value as JiraListIssuesResult];
  });
  const issuesByKey = new Map<string, JiraIssueSummary>();
  for (const page of pages) {
    for (const issue of page.issues) {
      issuesByKey.set(issue.key, issue);
    }
  }
  const lastPage = pages.at(-1) ?? null;
  const firstFailure = results.find((result) => result._tag === "Failure") ?? null;

  const refresh = useCallback(() => {
    const firstPage = pageAtoms[0];
    setPagination({ targetKey, tokens: INITIAL_PAGE_TOKENS });
    if (firstPage) {
      appAtomRegistry.refresh(firstPage);
    }
  }, [pageAtoms, targetKey]);

  const loadNext = useCallback(() => {
    const nextPageToken = lastPage?.nextPageToken ?? null;
    if (targetKey === null || nextPageToken === null) return;
    setPagination((current) => {
      const currentTokens = current.targetKey === targetKey ? current.tokens : INITIAL_PAGE_TOKENS;
      return currentTokens.includes(nextPageToken)
        ? { targetKey, tokens: currentTokens }
        : { targetKey, tokens: [...currentTokens, nextPageToken] };
    });
  }, [lastPage?.nextPageToken, targetKey]);

  return {
    issues: [...issuesByKey.values()],
    error: firstFailure ? formatAsyncResultError(firstFailure) : null,
    isPending: results.some((result) => result.waiting),
    nextPageToken: lastPage?.nextPageToken ?? null,
    refresh,
    loadNext,
  };
}

export function useJiraComments(input: {
  readonly environmentId: EnvironmentId | null;
  readonly issueIdOrKey: string | null;
  readonly settings: ServerSettings;
}) {
  const configured = isJiraConfigured(input.settings);
  const issueIdOrKey = input.issueIdOrKey?.trim() || null;
  const targetKey =
    input.environmentId !== null && configured && issueIdOrKey !== null
      ? JSON.stringify([input.environmentId, issueIdOrKey])
      : null;
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly offsets: ReadonlyArray<number>;
  }>({ targetKey, offsets: INITIAL_COMMENT_OFFSETS });
  const offsets = pagination.targetKey === targetKey ? pagination.offsets : INITIAL_COMMENT_OFFSETS;

  const pageAtoms = useMemo(
    () =>
      input.environmentId !== null && configured && issueIdOrKey !== null
        ? offsets.map((startAt) =>
            jiraEnvironment.listComments({
              environmentId: input.environmentId!,
              input: {
                issueIdOrKey,
                startAt,
                maxResults: JIRA_COMMENTS_PAGE_SIZE,
                orderBy: "created",
              },
            }),
          )
        : [],
    [configured, input.environmentId, issueIdOrKey, offsets],
  );
  const pagesAtom = useMemo(
    () =>
      Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
        Atom.withLabel(`web:jira-comment-pages:${targetKey ?? "empty"}`),
      ),
    [pageAtoms, targetKey],
  );
  const results = useAtomValue(pagesAtom);
  const pages = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value as JiraListCommentsResult];
  });
  const commentsById = new Map<string, JiraComment>();
  for (const page of pages) {
    for (const comment of page.comments) {
      commentsById.set(comment.id, comment);
    }
  }
  const lastPage = pages.at(-1) ?? null;
  const firstFailure = results.find((result) => result._tag === "Failure") ?? null;
  const hasNextPage = lastPage !== null && !lastPage.isLast;

  const refresh = useCallback(() => {
    const firstPage = pageAtoms[0];
    setPagination({ targetKey, offsets: INITIAL_COMMENT_OFFSETS });
    if (firstPage) {
      appAtomRegistry.refresh(firstPage);
    }
  }, [pageAtoms, targetKey]);

  const loadNext = useCallback(() => {
    if (targetKey === null || lastPage === null || lastPage.isLast) return;
    const nextOffset = lastPage.startAt + lastPage.maxResults;
    setPagination((current) => {
      const currentOffsets =
        current.targetKey === targetKey ? current.offsets : INITIAL_COMMENT_OFFSETS;
      return currentOffsets.includes(nextOffset)
        ? { targetKey, offsets: currentOffsets }
        : { targetKey, offsets: [...currentOffsets, nextOffset] };
    });
  }, [lastPage, targetKey]);

  return {
    comments: [...commentsById.values()],
    error: firstFailure ? formatAsyncResultError(firstFailure) : null,
    isPending: results.length > 0 && results.every((result) => result.waiting),
    isLoadingNext: offsets.length > 1 && (results.at(-1)?.waiting ?? false),
    hasNextPage,
    refresh,
    loadNext,
  };
}

export function useJiraMentionSearch(input: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly query: string | null;
  /** Override the JQL scope. Defaults to a broad recency-ordered issue search. */
  readonly jql?: string | undefined;
  /** Override how many issues to fetch. Defaults to {@link JIRA_MENTION_LIMIT}. */
  readonly limit?: number | undefined;
}) {
  const configured = isJiraConfigured(input.settings);
  const limit = input.limit ?? JIRA_MENTION_LIMIT;
  const normalizedTarget = useMemo(
    () => ({
      environmentId: input.environmentId,
      query: input.query ?? "",
      currentJQL: input.jql?.trim() || JIRA_ALL_ISSUES_JQL,
    }),
    [input.environmentId, input.query, input.jql],
  );
  const debouncedTarget = useDebouncedValue(normalizedTarget, JIRA_MENTION_DEBOUNCE_MS);
  const query = useEnvironmentQuery(
    debouncedTarget.environmentId !== null && configured && input.query !== null
      ? jiraEnvironment.searchIssueMentions({
          environmentId: debouncedTarget.environmentId,
          input: {
            query: debouncedTarget.query,
            currentJQL: debouncedTarget.currentJQL,
            limit,
          },
        })
      : null,
  );

  return {
    issues: query.data?.issues ?? EMPTY_ISSUES,
    error: query.error,
    isPending:
      configured &&
      input.query !== null &&
      (normalizedTarget.query !== debouncedTarget.query || query.isPending),
  };
}

export function useJiraUserMentionSearch(input: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly query: string | null;
}) {
  const configured = isJiraConfigured(input.settings);
  const normalizedTarget = useMemo(
    () => ({ environmentId: input.environmentId, query: input.query ?? "" }),
    [input.environmentId, input.query],
  );
  const debouncedTarget = useDebouncedValue(normalizedTarget, JIRA_MENTION_DEBOUNCE_MS);
  // Unlike the issue picker, Jira's /user/search has no empty-query listing, so
  // we only search once the user types at least one character.
  const hasQuery = input.query !== null && input.query.trim().length > 0;
  const query = useEnvironmentQuery(
    debouncedTarget.environmentId !== null && configured && debouncedTarget.query.trim().length > 0
      ? jiraEnvironment.searchUserMentions({
          environmentId: debouncedTarget.environmentId,
          input: {
            query: debouncedTarget.query,
            limit: JIRA_MENTION_LIMIT,
          },
        })
      : null,
  );

  return {
    users: query.data?.users ?? EMPTY_USERS,
    error: query.error,
    isPending:
      configured &&
      hasQuery &&
      (normalizedTarget.query !== debouncedTarget.query || query.isPending),
  };
}

export function useJiraAssignableUserSearch(input: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly issueIdOrKey: string | null;
  readonly query: string;
  readonly enabled?: boolean | undefined;
}) {
  const configured = isJiraConfigured(input.settings);
  const enabled = input.enabled ?? true;
  const normalizedTarget = useMemo(
    () => ({
      environmentId: input.environmentId,
      issueIdOrKey: input.issueIdOrKey?.trim() || null,
      query: input.query,
    }),
    [input.environmentId, input.issueIdOrKey, input.query],
  );
  const debouncedTarget = useDebouncedValue(normalizedTarget, JIRA_ASSIGNABLE_USER_DEBOUNCE_MS);
  const query = useEnvironmentQuery(
    enabled &&
      debouncedTarget.environmentId !== null &&
      configured &&
      debouncedTarget.issueIdOrKey !== null
      ? jiraEnvironment.searchAssignableUsers({
          environmentId: debouncedTarget.environmentId,
          input: buildAssignableUsersQueryInput({
            issueIdOrKey: debouncedTarget.issueIdOrKey,
            query: debouncedTarget.query,
            maxResults: JIRA_ASSIGNABLE_USER_LIMIT,
          }),
        })
      : null,
  );

  return {
    users: query.data?.users ?? EMPTY_ASSIGNABLE_USERS,
    error: query.error,
    isPending:
      enabled &&
      configured &&
      normalizedTarget.issueIdOrKey !== null &&
      (normalizedTarget.query !== debouncedTarget.query || query.isPending),
  };
}

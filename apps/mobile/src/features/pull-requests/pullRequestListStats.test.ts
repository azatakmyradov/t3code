import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  PullRequestListEntry,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { pullRequestListParams, pullRequestTarget } from "./pullRequestTarget";
import type { EnvironmentPullRequestListEntry } from "./pullRequestList";
import {
  mergePullRequestListStats,
  EMPTY_PULL_REQUEST_LIST_STATS,
  recordListedPullRequests,
  recordAnsweredPullRequestStats,
  pullRequestListStatKey,
  pullRequestListStatRef,
} from "./pullRequestListStats";

const decodeEntry = Schema.decodeUnknownSync(PullRequestListEntry);

function row(
  patch: Partial<EnvironmentPullRequestListEntry> = {},
): EnvironmentPullRequestListEntry {
  return {
    environmentId: EnvironmentId.make("env"),
    projectId: ProjectId.make("project"),
    projectTitle: "Project",
    provider: SourceControlProviderKind.make("github"),
    host: "github.com",
    repository: "org/repo",
    number: 1,
    title: "Change",
    url: "https://github.com/org/repo/pull/1",
    author: null,
    headBranch: "change",
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "unknown",
    additions: 0,
    deletions: 0,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    viewerReviewRequested: false,
    labels: [],
    ...patch,
  };
}
const stat = (entry: EnvironmentPullRequestListEntry, additions: number) => ({
  projectId: entry.projectId,
  repository: entry.repository,
  number: entry.number,
  additions,
  deletions: 1,
});

describe("mobile pull request line-count cache", () => {
  it("keeps same-repository counts attached to their requested project and account", () => {
    const personal = row({ viewer: "personal", expectedAccountId: "101" });
    const work = row({
      projectId: ProjectId.make("work"),
      viewer: "work",
      expectedAccountId: "202",
    });
    const refs = [personal, work].map(pullRequestListStatRef);
    expect(refs).toEqual([
      {
        projectId: personal.projectId,
        host: "github.com",
        repository: "org/repo",
        number: 1,
        expectedAccountId: "101",
      },
      {
        projectId: work.projectId,
        host: "github.com",
        repository: "org/repo",
        number: 1,
        expectedAccountId: "202",
      },
    ]);
    const cache = mergePullRequestListStats(
      new Map(),
      [personal, work],
      [stat(work, 90), stat(personal, 10)],
    );
    expect(cache.get(pullRequestListStatKey(personal))?.additions).toBe(10);
    expect(cache.get(pullRequestListStatKey(work))?.additions).toBe(90);
  });
  it("does not apply an earlier account's counts after its viewer changes", () => {
    const personal = row({ viewer: "personal", expectedAccountId: "101" });
    const work = row({ viewer: "work", expectedAccountId: "202" });
    const cache = mergePullRequestListStats(new Map(), [personal], [stat(personal, 10)]);
    expect(cache.get(pullRequestListStatKey(work))).toBeUndefined();
    expect(cache.get(pullRequestListStatKey({ ...personal, viewer: "other" }))).toBeUndefined();
    const refreshed = mergePullRequestListStats(cache, [work], [stat(work, 90)]);
    expect(refreshed.get(pullRequestListStatKey(work))?.additions).toBe(90);
    expect(refreshed.get(pullRequestListStatKey(personal))?.additions).toBe(10);
  });
  it("round-trips the server account guard into stats refs and separates same-project responses", () => {
    const personal = row({ expectedAccountId: "101", viewer: "personal" });
    const work = row({ expectedAccountId: "202", viewer: "work" });
    const decoded = [personal, work].map((entry) => ({
      ...decodeEntry(JSON.parse(JSON.stringify(entry))),
      environmentId: entry.environmentId,
    }));
    expect(decoded.map((entry) => pullRequestListStatRef(entry).expectedAccountId)).toEqual([
      "101",
      "202",
    ]);
    expect(decoded.map((entry) => pullRequestTarget(pullRequestListParams(entry)).input)).toEqual(
      decoded.map(pullRequestListStatRef),
    );
    const cache = mergePullRequestListStats(new Map(), decoded, [
      { ...stat(work, 90), host: work.host, expectedAccountId: "202" },
      { ...stat(personal, 10), host: personal.host, expectedAccountId: "101" },
    ]);
    expect(cache.get(pullRequestListStatKey(decoded[0]!))?.additions).toBe(10);
    expect(cache.get(pullRequestListStatKey(decoded[1]!))?.additions).toBe(90);
    expect(
      mergePullRequestListStats(
        new Map(),
        [work],
        [{ ...stat(personal, 10), host: personal.host, expectedAccountId: "101" }],
      ).size,
    ).toBe(0);
  });
  it.each([{ expectedAccountId: "202" }, { host: "github.enterprise" }])(
    "rejects ambiguous wire results instead of assigning counts to another identity: %j",
    (patch) => {
      const personal = row({ expectedAccountId: "101" });
      const other = { ...personal, ...patch };
      expect(
        mergePullRequestListStats(new Map(), [personal, other], [stat(personal, 10)]).size,
      ).toBe(0);
    },
  );
});

it("invalidates changed revisions within their requested account and refreshes the answering query", () => {
  const personal = row({ viewer: "personal", expectedAccountId: "101" });
  const work = row({ viewer: "work", expectedAccountId: "202" });
  const input = { refs: [personal, work].map(pullRequestListStatRef) };
  const listed = recordListedPullRequests(EMPTY_PULL_REQUEST_LIST_STATS, [personal, work]);
  expect(listed.refresh).toEqual([]);
  const answered = recordAnsweredPullRequestStats(
    listed.cache,
    input,
    [personal, work],
    [
      { ...stat(personal, 10), expectedAccountId: "101" },
      { ...stat(work, 90), expectedAccountId: "202" },
    ],
  );
  expect(recordListedPullRequests(answered, [personal, work])).toEqual({
    cache: answered,
    refresh: [],
  });
  const pushed = recordListedPullRequests(answered, [
    { ...personal, updatedAt: "2026-10-20" },
    work,
  ]);
  expect(pushed.cache.stats.get(pullRequestListStatKey(personal))).toBeUndefined();
  expect(pushed.cache.stats.get(pullRequestListStatKey(work))?.additions).toBe(90);
  expect(pushed.refresh).toEqual([input]);
});

import { beforeEach, describe, expect, it } from "vite-plus/test";
import { ProjectId } from "@t3tools/contracts";

import {
  type PendingReviewComment,
  pullRequestReviewKey,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

function comment(id: string, body = id): PendingReviewComment {
  return { id, body, path: "src/app.ts", position: { kind: "added", newLine: 1 } };
}

describe("pull request review drafts", () => {
  beforeEach(() => {
    usePullRequestReviewStore.setState({ drafts: {}, summaries: {} });
  });

  it("removes only the line comments included in a submitted snapshot", () => {
    const store = usePullRequestReviewStore.getState();
    store.addComment("review-a", comment("submitted"));
    const submittedIds =
      usePullRequestReviewStore.getState().drafts["review-a"]?.map((entry) => entry.id) ?? [];

    usePullRequestReviewStore.getState().addComment("review-a", comment("added-in-flight"));
    usePullRequestReviewStore.getState().removeComments("review-a", submittedIds);

    expect(usePullRequestReviewStore.getState().drafts["review-a"]).toEqual([
      comment("added-in-flight"),
    ]);
  });

  it("keeps summary bodies isolated by review key", () => {
    const store = usePullRequestReviewStore.getState();
    store.setSummary("review-a", "Summary A");
    store.setSummary("review-b", "Summary B");
    store.clearSummary("review-a", "Summary A");

    expect(usePullRequestReviewStore.getState().summaries).toEqual({
      "review-b": "Summary B",
    });
  });

  it("keeps drafts on different hosts separate when a thread reviews the same repository and number", () => {
    const reference = {
      projectId: ProjectId.make("project-a"),
      repository: "owner/repo",
      number: 7,
    };
    const publicKey = pullRequestReviewKey({ ...reference, host: "github.com" });
    const enterpriseKey = pullRequestReviewKey({ ...reference, host: "github.example.com" });
    const store = usePullRequestReviewStore.getState();
    store.addComment(publicKey, comment("public"));
    store.setSummary(publicKey, "Public review");

    expect(usePullRequestReviewStore.getState().drafts[enterpriseKey]).toBeUndefined();
    expect(usePullRequestReviewStore.getState().summaries[enterpriseKey]).toBeUndefined();

    store.addComment(enterpriseKey, comment("enterprise"));
    store.setSummary(enterpriseKey, "Enterprise review");
    store.clear(enterpriseKey);
    store.clearSummary(enterpriseKey, "Enterprise review");

    expect(usePullRequestReviewStore.getState().drafts[publicKey]).toEqual([comment("public")]);
    expect(usePullRequestReviewStore.getState().summaries[publicKey]).toBe("Public review");
  });

  it("keeps review comments and summaries isolated across an account switch in the same project", () => {
    const reference = {
      projectId: ProjectId.make("project-a"),
      host: "github.com",
      repository: "owner/repo",
      number: 7,
    };
    const keyA = pullRequestReviewKey({ ...reference, expectedAccountId: "account-a" });
    const keyB = pullRequestReviewKey({ ...reference, expectedAccountId: "account-b" });
    const store = usePullRequestReviewStore.getState();
    store.addComment(keyA, comment("account-a-draft"));
    store.setSummary(keyA, "Account A review");
    expect(usePullRequestReviewStore.getState().drafts[keyB]).toBeUndefined();
    expect(usePullRequestReviewStore.getState().summaries[keyB]).toBeUndefined();
    expect(
      usePullRequestReviewStore.getState().summaries[pullRequestReviewKey(reference)],
    ).toBeUndefined();
    store.addComment(keyB, comment("account-b-draft"));
    store.setSummary(keyB, "Account B review");
    store.clear(keyB);
    store.clearSummary(keyB, "Account B review");
    expect(usePullRequestReviewStore.getState().drafts[keyA]).toEqual([comment("account-a-draft")]);
    expect(usePullRequestReviewStore.getState().summaries[keyA]).toBe("Account A review");
  });

  it("does not clear a summary revised while submission is in flight", () => {
    const store = usePullRequestReviewStore.getState();
    store.setSummary("review-a", "Submitted body");
    usePullRequestReviewStore.getState().setSummary("review-a", "Revised body");
    usePullRequestReviewStore.getState().clearSummary("review-a", "Submitted body");

    expect(usePullRequestReviewStore.getState().summaries["review-a"]).toBe("Revised body");
  });
});

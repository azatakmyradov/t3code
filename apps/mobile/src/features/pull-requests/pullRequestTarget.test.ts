import { describe, expect, it } from "vite-plus/test";
import { pullRequestTarget } from "./pullRequestTarget";

describe("mobile pull request targets", () => {
  it("retains project and account guards for detail reads and mutation payloads", () => {
    const params = {
      environmentId: "env",
      projectId: "project",
      host: "github.com",
      repository: "org/repo",
      number: 1,
      expectedAccountId: "101",
    };
    const target = pullRequestTarget(params);
    expect(target).toEqual({
      environmentId: "env",
      input: {
        projectId: "project",
        host: "github.com",
        repository: "org/repo",
        number: 1,
        expectedAccountId: "101",
      },
    });
    expect(pullRequestTarget({ ...params, expectedAccountId: "202" }).input).not.toEqual(
      target.input,
    );
    expect(pullRequestTarget({ ...params, projectId: "other" }).input.projectId).toBe("other");
  });
  it("keeps legacy references without inventing an account identity", () => {
    expect(
      pullRequestTarget({
        environmentId: "env",
        projectId: "project",
        repository: "org/repo",
        number: 1,
      }).input,
    ).toEqual({ projectId: "project", repository: "org/repo", number: 1 });
  });
});

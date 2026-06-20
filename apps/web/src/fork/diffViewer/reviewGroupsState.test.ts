import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildReviewGroupsSingleFlightKey } from "./reviewGroupsState";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

describe("buildReviewGroupsSingleFlightKey", () => {
  it("includes sourceId so different diff sources do not share an in-flight request", () => {
    const workingTreeKey = buildReviewGroupsSingleFlightKey({
      environmentId: ENVIRONMENT_ID,
      input: { cwd: "/repo", sourceId: "working-tree" },
    });
    const branchRangeKey = buildReviewGroupsSingleFlightKey({
      environmentId: ENVIRONMENT_ID,
      input: { cwd: "/repo", sourceId: "branch-range" },
    });

    expect(workingTreeKey).not.toBe(branchRangeKey);
    expect(workingTreeKey).toBe(
      buildReviewGroupsSingleFlightKey({
        environmentId: ENVIRONMENT_ID,
        input: { cwd: "/repo", sourceId: "working-tree" },
      }),
    );
  });

  it("includes baseRef so branch ranges with different bases do not share a request", () => {
    expect(
      buildReviewGroupsSingleFlightKey({
        environmentId: ENVIRONMENT_ID,
        input: { cwd: "/repo", sourceId: "branch-range", baseRef: "main" },
      }),
    ).not.toBe(
      buildReviewGroupsSingleFlightKey({
        environmentId: ENVIRONMENT_ID,
        input: { cwd: "/repo", sourceId: "branch-range", baseRef: "release" },
      }),
    );
  });
});

import { describe, expect, it } from "vite-plus/test";

import type { ReviewSemanticGroup } from "@t3tools/contracts";

import { getRenderablePatch } from "~/lib/diffRendering";

import {
  buildReviewDiffGroupViews,
  OTHER_GROUP_ID,
  reviewGroupRiskLabel,
  resolveReviewDiffSidebarMode,
} from "./reviewDiffGroupsModel";
import { buildReviewDiffFiles } from "./reviewDiffModel";

const SAMPLE_PATCH = `diff --git a/public/favicon.svg b/public/favicon.svg
new file mode 100644
index 0000000..abcd123
--- /dev/null
+++ b/public/favicon.svg
@@ -0,0 +1,2 @@
+<svg></svg>
+<!-- icon -->
diff --git a/src/main.ts b/src/main.ts
index 1111111..2222222 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
diff --git a/index.html b/index.html
deleted file mode 100644
index 3333333..0000000
--- a/index.html
+++ /dev/null
@@ -1,2 +0,0 @@
-<!doctype html>
-<html></html>
`;

function parseSampleFiles() {
  const renderable = getRenderablePatch(SAMPLE_PATCH, "review-diff-groups-test");
  if (!renderable || renderable.kind !== "files") {
    throw new Error("Expected the sample patch to parse into files.");
  }
  return buildReviewDiffFiles(renderable.files);
}

function group(
  overrides: Partial<ReviewSemanticGroup> & Pick<ReviewSemanticGroup, "id" | "files">,
): ReviewSemanticGroup {
  return {
    title: "Group",
    description: "",
    whatChanged: "",
    reviewFocus: "",
    risk: 50,
    riskLevel: "high",
    riskReason: "",
    ...overrides,
  };
}

describe("buildReviewDiffGroupViews", () => {
  it("resolves paths (incl. b/ prefix), drops unknowns, and backfills leftovers", () => {
    const files = parseSampleFiles();
    const views = buildReviewDiffGroupViews(
      [
        group({
          id: "g1",
          title: "Critical",
          riskLevel: "critical",
          risk: 90,
          files: ["src/main.ts", "b/public/favicon.svg", "does/not/exist.ts"],
        }),
      ],
      files,
    );

    expect(views).toHaveLength(2);
    expect(views[0]!.id).toBe("g1");
    expect(views[0]!.files.map((f) => f.path)).toEqual(["src/main.ts", "public/favicon.svg"]);

    const other = views[1]!;
    expect(other.id).toBe(OTHER_GROUP_ID);
    expect(other.isFallback).toBe(true);
    expect(other.files.map((f) => f.path)).toEqual(["index.html"]);
  });

  it("assigns each file to only the first (highest-risk) group that claims it", () => {
    const files = parseSampleFiles();
    const views = buildReviewDiffGroupViews(
      [
        group({ id: "g1", files: ["src/main.ts"] }),
        group({ id: "g2", files: ["src/main.ts", "public/favicon.svg"] }),
      ],
      files,
    );

    expect(views.find((v) => v.id === "g1")!.files.map((f) => f.path)).toEqual(["src/main.ts"]);
    expect(views.find((v) => v.id === "g2")!.files.map((f) => f.path)).toEqual([
      "public/favicon.svg",
    ]);
  });

  it("drops groups that resolve to zero files", () => {
    const files = parseSampleFiles();
    const views = buildReviewDiffGroupViews(
      [group({ id: "ghost", files: ["nope/missing.ts"] })],
      files,
    );

    // Only the synthetic Other-changes group, holding every (unassigned) file.
    expect(views).toHaveLength(1);
    expect(views[0]!.id).toBe(OTHER_GROUP_ID);
    expect(views[0]!.files).toHaveLength(files.length);
  });

  it("aggregates per-group additions/deletions", () => {
    const files = parseSampleFiles();
    const views = buildReviewDiffGroupViews([group({ id: "g1", files: ["src/main.ts"] })], files);
    const main = views.find((v) => v.id === "g1")!;
    expect(main.stat.additions).toBe(1);
    expect(main.stat.deletions).toBe(1);
  });
});

describe("reviewGroupRiskLabel", () => {
  it("maps levels to labels", () => {
    expect(reviewGroupRiskLabel("critical")).toBe("Critical");
    expect(reviewGroupRiskLabel("high")).toBe("High");
    expect(reviewGroupRiskLabel("medium")).toBe("Medium");
    expect(reviewGroupRiskLabel("low")).toBe("Low");
  });
});

describe("resolveReviewDiffSidebarMode", () => {
  it("resolves to files when no groups exist", () => {
    expect(
      resolveReviewDiffSidebarMode({
        overrideMode: null,
        hasGroups: false,
        defaultMode: "groups",
      }),
    ).toBe("files");
    expect(
      resolveReviewDiffSidebarMode({
        overrideMode: "groups",
        hasGroups: false,
        defaultMode: "groups",
      }),
    ).toBe("files");
  });

  it("resolves to groups when groups exist and the default is groups", () => {
    expect(
      resolveReviewDiffSidebarMode({
        overrideMode: null,
        hasGroups: true,
        defaultMode: "groups",
      }),
    ).toBe("groups");
  });

  it("resolves to files when groups exist and the default is files", () => {
    expect(
      resolveReviewDiffSidebarMode({
        overrideMode: null,
        hasGroups: true,
        defaultMode: "files",
      }),
    ).toBe("files");
  });

  it("lets a request-local override win over the default when groups exist", () => {
    expect(
      resolveReviewDiffSidebarMode({
        overrideMode: "groups",
        hasGroups: true,
        defaultMode: "files",
      }),
    ).toBe("groups");
    expect(
      resolveReviewDiffSidebarMode({
        overrideMode: "files",
        hasGroups: true,
        defaultMode: "groups",
      }),
    ).toBe("files");
  });
});

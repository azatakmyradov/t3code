import { describe, expect, it } from "vite-plus/test";

import { getRenderablePatch } from "~/lib/diffRendering";

import {
  buildReviewDiffFiles,
  buildReviewDiffTree,
  flattenReviewDiffTreeFiles,
  resolveReviewDiffStatus,
  reviewDiffStatusLabel,
  summarizeReviewDiffStat,
  type ReviewDiffTreeDirectoryNode,
} from "./reviewDiffModel";

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
  const renderable = getRenderablePatch(SAMPLE_PATCH, "review-diff-model-test");
  if (!renderable || renderable.kind !== "files") {
    throw new Error("Expected the sample patch to parse into files.");
  }
  return buildReviewDiffFiles(renderable.files);
}

describe("resolveReviewDiffStatus", () => {
  it("maps pierre change types to review statuses", () => {
    expect(resolveReviewDiffStatus("new")).toBe("added");
    expect(resolveReviewDiffStatus("deleted")).toBe("deleted");
    expect(resolveReviewDiffStatus("change")).toBe("modified");
    expect(resolveReviewDiffStatus("rename-pure")).toBe("renamed");
    expect(resolveReviewDiffStatus("rename-changed")).toBe("renamed");
  });

  it("exposes single-letter status labels", () => {
    expect(reviewDiffStatusLabel("added")).toBe("A");
    expect(reviewDiffStatusLabel("deleted")).toBe("D");
    expect(reviewDiffStatusLabel("modified")).toBe("M");
    expect(reviewDiffStatusLabel("renamed")).toBe("R");
  });
});

describe("buildReviewDiffFiles", () => {
  it("derives status, per-file stats, and a stable path order", () => {
    const files = parseSampleFiles();

    expect(files.map((file) => file.path)).toEqual([
      "index.html",
      "public/favicon.svg",
      "src/main.ts",
    ]);

    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get("public/favicon.svg")?.status).toBe("added");
    expect(byPath.get("public/favicon.svg")?.stat).toEqual({ additions: 2, deletions: 0 });
    expect(byPath.get("index.html")?.status).toBe("deleted");
    expect(byPath.get("index.html")?.stat).toEqual({ additions: 0, deletions: 2 });
    expect(byPath.get("src/main.ts")?.status).toBe("modified");
    expect(byPath.get("src/main.ts")?.stat).toEqual({ additions: 1, deletions: 1 });
  });

  it("summarizes aggregate additions and deletions", () => {
    expect(summarizeReviewDiffStat(parseSampleFiles())).toEqual({
      additions: 3,
      deletions: 3,
    });
  });
});

describe("buildReviewDiffTree", () => {
  it("nests files under directories, directories before files", () => {
    const tree = buildReviewDiffTree(parseSampleFiles());

    expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual([
      "directory:public",
      "directory:src",
      "file:index.html",
    ]);

    const publicDir = tree[0] as ReviewDiffTreeDirectoryNode;
    expect(publicDir.children.map((node) => node.path)).toEqual(["public/favicon.svg"]);

    const srcDir = tree[1] as ReviewDiffTreeDirectoryNode;
    expect(srcDir.children.map((node) => node.path)).toEqual(["src/main.ts"]);
  });
});

describe("flattenReviewDiffTreeFiles", () => {
  it("orders files like the sidebar (directories first, depth-first), not by flat path", () => {
    const tree = buildReviewDiffTree(parseSampleFiles());
    expect(flattenReviewDiffTreeFiles(tree).map((file) => file.path)).toEqual([
      "public/favicon.svg",
      "src/main.ts",
      "index.html",
    ]);
  });
});

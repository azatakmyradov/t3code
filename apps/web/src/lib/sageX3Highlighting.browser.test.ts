import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { expect, it } from "vite-plus/test";

import { getRenderablePatch } from "./diffRendering";
import { PREFERRED_HIGHLIGHTER } from "./syntaxHighlighting";

it("sends the Sage X3 grammar to real diff workers", async () => {
  const parsed = getRenderablePatch(
    [
      "diff --git a/TRT/ZDEMO.src b/TRT/ZDEMO.src",
      "--- a/TRT/ZDEMO.src",
      "+++ b/TRT/ZDEMO.src",
      "@@ -1,4 +1,4 @@",
      " $ACTION",
      " Local Char MESSAGE(80)",
      '-MESSAGE = "Before" # comment',
      '+MESSAGE = "After" # comment',
      " Return",
      "",
    ].join("\n"),
  );
  if (parsed?.kind !== "files") throw new Error("Expected file diffs");
  const pool = new WorkerPoolManager(
    { workerFactory: () => new DiffsWorker(), poolSize: 1 },
    { theme: "pierre-dark", preferredHighlighter: PREFERRED_HIGHLIGHTER },
  );
  try {
    await pool.initialize();
    const file = parsed.files[0]!;
    await pool.primeDiffHighlightCache(file);
    const result = pool.getDiffResultCache(file);
    expect(result).toBeDefined();
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("After");
    expect(new Set(serialized.match(/#[0-9a-f]{6}/gi)).size).toBeGreaterThan(3);
  } finally {
    pool.terminate();
  }
});

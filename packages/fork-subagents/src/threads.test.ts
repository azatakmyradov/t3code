import { describe, expect, it } from "vite-plus/test";

import { isSubagentThreadId, makeSubagentThreadId } from "./threads.ts";

describe("subagent thread ids", () => {
  it("classifies only the reserved prefix", () => {
    expect(makeSubagentThreadId("1234")).toBe("t3-internal-subagent-1234");
    expect(isSubagentThreadId("t3-internal-subagent-1234")).toBe(true);
    expect(isSubagentThreadId("regular-t3-internal-subagent-1234")).toBe(false);
  });
});

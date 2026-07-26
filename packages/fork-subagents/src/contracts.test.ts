import { ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { SubagentId, SubagentOutputSection } from "./contracts.ts";

const decodeSubagentOutputSection = Schema.decodeUnknownSync(SubagentOutputSection);

describe("subagent contracts", () => {
  it("accepts complete settled output", () => {
    const output = "x".repeat(64 * 1_024);
    const decoded = decodeSubagentOutputSection({
      displayId: SubagentId.make("sa-1"),
      threadId: ThreadId.make("t3-internal-subagent-child-1"),
      outcome: "completed",
      output,
      error: null,
    });

    expect(decoded.output).toBe(output);
  });
});

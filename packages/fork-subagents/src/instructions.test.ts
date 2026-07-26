import { describe, expect, it } from "vite-plus/test";

import {
  CHILD_PROVIDER_INSTRUCTIONS,
  T3_MANAGED_SUBAGENT_TOOL_INSTRUCTIONS,
} from "./instructions.ts";

describe("CHILD_PROVIDER_INSTRUCTIONS", () => {
  it("prevents T3-managed child agents from delegating", () => {
    expect(CHILD_PROVIDER_INSTRUCTIONS).toContain(
      "Do not orchestrate, spawn, or delegate to other agents",
    );
  });
});

describe("T3_MANAGED_SUBAGENT_TOOL_INSTRUCTIONS", () => {
  it("names every T3-managed subagent tool", () => {
    for (const tool of [
      "subagent_models",
      "subagent_spawn",
      "subagent_check",
      "subagent_wait",
      "subagent_list",
      "subagent_cancel",
    ]) {
      expect(T3_MANAGED_SUBAGENT_TOOL_INSTRUCTIONS).toContain(`\`${tool}\``);
    }
  });
});

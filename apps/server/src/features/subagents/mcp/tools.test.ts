import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { SubagentListTool, SubagentModelsTool } from "./tools.ts";

it("exports object schemas for parameterless tools", () => {
  for (const tool of [SubagentListTool, SubagentModelsTool]) {
    expect(Tool.getJsonSchema(tool)).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  }
});

import { describe, expect, it } from "vite-plus/test";

import { subagentStatusColor } from "./subagentStatusColor";

describe("subagentStatusColor", () => {
  it("uses orange for a running subagent", () => {
    expect(subagentStatusColor("running")).toBe("bg-orange-500");
  });

  it("keeps terminal statuses distinct", () => {
    expect(subagentStatusColor("done")).toBe("bg-emerald-500");
    expect(subagentStatusColor("error")).toBe("bg-red-500");
  });
});

import { describe, expect, it } from "vite-plus/test";

import { clampRisk, deriveRiskLevel, normalizeSemanticGroups } from "./reviewGroups.ts";
import type { SemanticDiffGroup } from "./textGeneration.ts";

function rawGroup(overrides: Partial<SemanticDiffGroup>): SemanticDiffGroup {
  return {
    title: "Group",
    description: "desc",
    whatChanged: "changed",
    reviewFocus: "review",
    risk: 50,
    riskReason: "reason",
    files: ["src/a.ts"],
    ...overrides,
  };
}

describe("clampRisk", () => {
  it("rounds and clamps into 0-100", () => {
    expect(clampRisk(-10)).toBe(0);
    expect(clampRisk(0)).toBe(0);
    expect(clampRisk(49.4)).toBe(49);
    expect(clampRisk(49.6)).toBe(50);
    expect(clampRisk(140)).toBe(100);
    expect(clampRisk(Number.NaN)).toBe(0);
  });
});

describe("deriveRiskLevel", () => {
  it("buckets scores", () => {
    expect(deriveRiskLevel(0)).toBe("low");
    expect(deriveRiskLevel(24)).toBe("low");
    expect(deriveRiskLevel(25)).toBe("medium");
    expect(deriveRiskLevel(49)).toBe("medium");
    expect(deriveRiskLevel(50)).toBe("high");
    expect(deriveRiskLevel(74)).toBe("high");
    expect(deriveRiskLevel(75)).toBe("critical");
    expect(deriveRiskLevel(100)).toBe("critical");
  });
});

describe("normalizeSemanticGroups", () => {
  it("sorts most-critical first, derives levels, assigns stable ids", () => {
    const groups = normalizeSemanticGroups([
      rawGroup({ title: "Low", risk: 10, files: ["docs/readme.md"] }),
      rawGroup({ title: "Critical", risk: 92, files: ["src/auth.ts"] }),
      rawGroup({ title: "Medium", risk: 40, files: ["src/util.ts"] }),
    ]);

    expect(groups.map((g) => g.title)).toEqual(["Critical", "Medium", "Low"]);
    expect(groups.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(groups.map((g) => g.riskLevel)).toEqual(["critical", "medium", "low"]);
  });

  it("clamps risk, cleans/dedupes files, drops empty groups, defaults blank titles", () => {
    const groups = normalizeSemanticGroups([
      rawGroup({ title: "  ", risk: 250, files: [" src/a.ts ", "src/a.ts", "  "] }),
      rawGroup({ title: "Empty", files: ["   ", ""] }),
    ]);

    expect(groups).toHaveLength(1);
    const [only] = groups;
    expect(only!.title).toBe("Untitled changes");
    expect(only!.risk).toBe(100);
    expect(only!.riskLevel).toBe("critical");
    expect(only!.files).toEqual(["src/a.ts"]);
  });
});

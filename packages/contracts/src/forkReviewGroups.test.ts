import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ReviewSemanticGroup, ReviewSemanticGroupRisk } from "./forkReviewGroups.ts";

const decodeRisk = Schema.decodeUnknownSync(ReviewSemanticGroupRisk);
const encodeReviewSemanticGroup = Schema.encodeUnknownSync(ReviewSemanticGroup);
const decodeReviewSemanticGroup = Schema.decodeUnknownSync(ReviewSemanticGroup);

describe("ReviewSemanticGroupRisk", () => {
  it("accepts in-range integers (0, 50, 100)", () => {
    expect(decodeRisk(0)).toBe(0);
    expect(decodeRisk(50)).toBe(50);
    expect(decodeRisk(100)).toBe(100);
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(() => decodeRisk(-1)).toThrow();
    expect(() => decodeRisk(101)).toThrow();
    expect(() => decodeRisk(50.5)).toThrow();
  });
});

describe("ReviewSemanticGroup encode", () => {
  const sampleGroup: ReviewSemanticGroup = {
    id: "g1",
    title: "Auth token refresh",
    description: "Refreshes the access token before it expires.",
    whatChanged: "Adds a refresh guard to the auth client.",
    reviewFocus: "Check the expiry math and the retry path.",
    risk: 80,
    riskLevel: "critical",
    riskReason: "Touches auth and can lock users out.",
    files: ["src/auth/client.ts"],
  };

  it("round-trips a populated group through the success schema", () => {
    // This is the exact path the RPC server uses to serialize each group in the
    // handler's success value; a broken `risk` bound would make it throw.
    const encoded = encodeReviewSemanticGroup(sampleGroup);
    const decoded = decodeReviewSemanticGroup(encoded);
    expect(decoded.risk).toBe(80);
    expect(decoded.riskLevel).toBe("critical");
    expect(decoded.files).toEqual(["src/auth/client.ts"]);
  });
});

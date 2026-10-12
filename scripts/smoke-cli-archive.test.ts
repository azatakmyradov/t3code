import { assert, describe, it } from "@effect/vitest";
import { cliVersionMatches } from "./smoke-cli-archive.ts";

describe("CLI archive version validation", () => {
  it("accepts the exact CLI version output", () => {
    assert.isTrue(cliVersionMatches("t3-fork v0.0.55\n", "0.0.55"));
    assert.isTrue(
      cliVersionMatches("t3 v0.0.56-nightly.20261012.1\n", "0.0.56-nightly.20261012.1"),
    );
  });

  it("rejects substring, channel, missing, and trailing-output mismatches", () => {
    assert.isFalse(cliVersionMatches("t3-fork v0.0.55\n", "0.0.5"));
    assert.isFalse(cliVersionMatches("t3-fork v0.0.55-nightly.1\n", "0.0.55"));
    assert.isFalse(cliVersionMatches("", "0.0.55"));
    assert.isFalse(cliVersionMatches("t3-fork v0.0.55\nfailed", "0.0.55"));
  });
});

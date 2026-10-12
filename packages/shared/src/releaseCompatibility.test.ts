import { describe, expect, it } from "vite-plus/test";

import { canTargetServerRelease, forkReleaseForVersion } from "./releaseCompatibility.ts";

const stable = { release: forkReleaseForVersion("0.0.44") };
const nightly = { release: forkReleaseForVersion("0.0.44-nightly.20261001.1") };

describe("release compatibility", () => {
  it("keeps genuine same-distribution stable and nightly upgrades eligible", () => {
    expect(canTargetServerRelease(stable, "0.0.45")).toBe(true);
    expect(canTargetServerRelease(nightly, "0.0.44-nightly.20261002.2")).toBe(true);
  });

  it("never infers a remote distribution from its version or absent metadata", () => {
    expect(canTargetServerRelease({}, "0.0.45")).toBe(false);
    expect(canTargetServerRelease(null, "0.0.45")).toBe(false);
    expect(
      canTargetServerRelease(
        { release: { distribution: "pingdotgg/t3code", channel: "stable" } },
        "0.0.45",
      ),
    ).toBe(false);
    expect(
      canTargetServerRelease(
        { release: { distribution: "pingdotgg/t3code", channel: "nightly" } },
        "0.0.45-nightly.20261002.2",
      ),
    ).toBe(false);
  });

  it("does not target a different release train or unsupported build", () => {
    expect(canTargetServerRelease(stable, "0.0.45-nightly.20261002.2")).toBe(false);
    expect(canTargetServerRelease(nightly, "0.0.45")).toBe(false);
    expect(
      canTargetServerRelease(
        { release: forkReleaseForVersion("0.0.45-preview.20261001.1") },
        "0.0.45-preview.20261002.2",
      ),
    ).toBe(false);
    expect(canTargetServerRelease(stable, "dev")).toBe(false);
    expect(forkReleaseForVersion("0.0.45-custom.1").channel).toBe("unknown");
  });
});

import { describe, expect, it } from "vite-plus/test";

import { AuthProvidersManageScope, AuthSettingsWriteScope } from "./auth.ts";
import { ProjectId } from "./baseSchemas.ts";
import { requiredScopesForServerSettingsPatch } from "./settings.ts";

describe("skill settings authorization", () => {
  it("requires settings write for environment and project skill switches", () => {
    expect(requiredScopesForServerSettingsPatch({ disabledSkills: ["review"] })).toEqual([
      AuthSettingsWriteScope,
    ]);
    expect(
      requiredScopesForServerSettingsPatch({
        projectSettingsOverrides: {
          [ProjectId.make("project-a")]: { disabledSkills: { review: false, deploy: true } },
        },
      }),
    ).toEqual([AuthSettingsWriteScope]);
  });

  it("still requires provider management for a mixed provider and skill patch", () => {
    expect(
      requiredScopesForServerSettingsPatch({ disabledSkills: ["review"], providerInstances: {} }),
    ).toEqual([AuthSettingsWriteScope, AuthProvidersManageScope]);
  });
});

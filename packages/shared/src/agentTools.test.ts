import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { resolveProjectSettings } from "./projectSettings.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const projectId = ProjectId.make("project-a");

describe("project skill overrides", () => {
  it("turns skills off and back on per project over the environment list", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      disabledSkills: ["grill-me", "prepare-pr"],
      projectSettingsOverrides: {
        [projectId]: { disabledSkills: { "prepare-pr": false, "expo-deployment": true } },
      },
    } satisfies ServerSettings;

    const resolved = resolveProjectSettings(settings, projectId);
    expect(resolved.sources.disabledSkills).toBe("project");
    expect(resolved.settings.disabledSkills).toEqual(["expo-deployment", "grill-me"]);
    expect(resolveProjectSettings(settings, null).settings.disabledSkills).toEqual([
      "grill-me",
      "prepare-pr",
    ]);
  });

  it("replaces the environment skill list and clears project switches", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      disabledSkills: ["old"],
      projectSettingsOverrides: { [projectId]: { disabledSkills: { review: true } } },
    };
    const next = applyServerSettingsPatch(current, {
      disabledSkills: ["new"],
      projectSettingsOverrides: { [projectId]: null },
    });
    expect(resolveProjectSettings(next, projectId).settings.disabledSkills).toEqual(["new"]);
    expect(next.projectSettingsOverrides).toEqual({});
  });
});

describe("removed custom MCP settings", () => {
  it("ignores legacy server settings while retaining skills and unrelated settings", () => {
    const settings = Schema.decodeUnknownSync(ServerSettings)({
      enableAgentBrowserAccess: false,
      disabledSkills: ["review"],
      // Removed fields do not need to match any old MCP schema to decode safely.
      mcpServers: { "t3-code": { transport: "invalid legacy config" } },
      projectSettingsOverrides: {
        [projectId]: {
          mcpServers: { tools: { enabled: true, transport: { command: "legacy-command" } } },
          disabledSkills: { review: false, deploy: true },
        },
      },
    });

    expect(settings.enableAgentBrowserAccess).toBe(false);
    expect(settings.disabledSkills).toEqual(["review"]);
    expect(settings).not.toHaveProperty("mcpServers");
    expect(settings.projectSettingsOverrides[projectId]).not.toHaveProperty("mcpServers");
    const resolved = resolveProjectSettings(settings, projectId);
    expect(resolved.settings.disabledSkills).toEqual(["deploy"]);
    expect(resolved.settings).not.toHaveProperty("mcpServers");
  });

  it("ignores legacy MCP patch fields instead of adding active settings", () => {
    const patch = Schema.decodeUnknownSync(ServerSettingsPatch)({
      mcpServers: { tools: { transport: { type: "stdio", command: "legacy-command" } } },
      disabledSkills: ["review"],
      projectSettingsOverrides: {
        [projectId]: {
          mcpServers: { tools: { enabled: false } },
          disabledSkills: { deploy: true },
        },
      },
    });
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, patch);
    expect(next.disabledSkills).toEqual(["review"]);
    expect(next).not.toHaveProperty("mcpServers");
    expect(next.projectSettingsOverrides[projectId]).toEqual({ disabledSkills: { deploy: true } });
  });
});

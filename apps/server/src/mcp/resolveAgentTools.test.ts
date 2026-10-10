import { DEFAULT_SERVER_SETTINGS, ProjectId, type ServerSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EMPTY_MCP_PROVIDER_SESSION_TOOLS } from "./McpProviderSession.ts";
import { resolveAgentTools } from "./resolveAgentTools.ts";

const projectId = ProjectId.make("project-skills");

describe("resolveAgentTools", () => {
  it("uses the empty session configuration when no skills are disabled", () => {
    expect(resolveAgentTools(DEFAULT_SERVER_SETTINGS, null)).toEqual(
      EMPTY_MCP_PROVIDER_SESSION_TOOLS,
    );
  });

  it("applies project switches and returns sorted, unique disabled skill names", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      disabledSkills: ["test", "deploy", "test"],
      projectSettingsOverrides: {
        [projectId]: { disabledSkills: { deploy: false, review: true } },
      },
    } satisfies ServerSettings;

    expect(resolveAgentTools(settings, projectId)).toEqual({
      disabledSkills: ["review", "test"],
      fingerprint: JSON.stringify({ disabledSkills: ["review", "test"] }),
    });
    expect(resolveAgentTools(settings, null).disabledSkills).toEqual(["deploy", "test"]);
  });

  it("keeps fingerprints stable for equivalent skills and changes them when a skill is enabled", () => {
    const first = resolveAgentTools(
      { ...DEFAULT_SERVER_SETTINGS, disabledSkills: ["test", "deploy", "test"] },
      null,
    );
    const reordered = resolveAgentTools(
      { ...DEFAULT_SERVER_SETTINGS, disabledSkills: ["deploy", "test"] },
      null,
    );
    const enabled = resolveAgentTools(
      { ...DEFAULT_SERVER_SETTINGS, disabledSkills: ["test"] },
      null,
    );

    expect(reordered.fingerprint).toBe(first.fingerprint);
    expect(enabled.fingerprint).not.toBe(first.fingerprint);
  });
});

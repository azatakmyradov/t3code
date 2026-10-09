import { describe, expect, it } from "vite-plus/test";

import { AuthProvidersManageScope, AuthSettingsWriteScope } from "./auth.ts";
import { ProjectId } from "./baseSchemas.ts";
import type { McpServerTransport, McpServerVariable } from "./agentTools.ts";
import {
  DEFAULT_SERVER_SETTINGS,
  requiredScopesForServerSettingsPatch,
  type ServerSettings,
  type ServerSettingsPatch,
} from "./settings.ts";

const projectId = ProjectId.make("project-a");
const transport: McpServerTransport = {
  type: "stdio",
  command: "npx",
  args: ["mcp-server"],
  env: [{ name: "TOKEN", sensitive: true, value: "", valueRedacted: true }],
};
const current: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  projectSettingsOverrides: {
    [projectId]: { mcpServers: { tools: { enabled: true, transport } } },
  },
};
const patchWithTransport = (next: McpServerTransport): ServerSettingsPatch => ({
  projectSettingsOverrides: {
    [projectId]: {
      disabledSkills: { review: true },
      mcpServers: { tools: { enabled: false, transport: next } },
    },
  },
});

describe("project settings authorization", () => {
  it("allows ordinary settings and switches that retain the existing transport", () => {
    expect(requiredScopesForServerSettingsPatch(patchWithTransport(transport), current)).toEqual([
      AuthSettingsWriteScope,
    ]);
    expect(
      requiredScopesForServerSettingsPatch(
        {
          projectSettingsOverrides: {
            [projectId]: {
              ...current.projectSettingsOverrides[projectId],
              defaultModelSelection: null,
            },
          },
        },
        current,
      ),
    ).toEqual([AuthSettingsWriteScope]);
    expect(
      requiredScopesForServerSettingsPatch(
        {
          projectSettingsOverrides: {
            [ProjectId.make("other")]: { mcpServers: { inherited: { enabled: false } } },
          },
        },
        current,
      ),
    ).toEqual([AuthSettingsWriteScope]);
  });

  it.each([
    { name: "command", next: { ...transport, command: "another-command" } },
    { name: "arguments", next: { ...transport, args: ["different-server"] } },
    {
      name: "credential",
      next: {
        ...transport,
        env: [{ name: "TOKEN", sensitive: true, value: "replacement", valueRedacted: true }],
      },
    },
    {
      name: "credential removal",
      next: { ...transport, env: [{ name: "TOKEN", sensitive: true, value: "" }] },
    },
    {
      name: "sensitivity",
      next: { ...transport, env: [{ name: "TOKEN", sensitive: false, value: "" }] },
    },
    {
      name: "variable name",
      next: {
        ...transport,
        env: [{ name: "OTHER", sensitive: true, value: "", valueRedacted: true }],
      },
    },
    { name: "transport type", next: { type: "http", url: "https://example.com/mcp", headers: [] } },
  ] satisfies ReadonlyArray<{ name: string; next: McpServerTransport }>)(
    "requires management for a changed $name",
    ({ next }) => {
      expect(requiredScopesForServerSettingsPatch(patchWithTransport(next), current)).toEqual([
        AuthSettingsWriteScope,
        AuthProvidersManageScope,
      ]);
    },
  );

  it.each([
    { projectSettingsOverrides: { [projectId]: null } },
    { projectSettingsOverrides: { [projectId]: { disabledSkills: { review: true } } } },
    { projectSettingsOverrides: { [projectId]: { mcpServers: { tools: { enabled: false } } } } },
    {
      projectSettingsOverrides: {
        [ProjectId.make("other")]: current.projectSettingsOverrides[projectId]!,
      },
    },
  ] satisfies ReadonlyArray<ServerSettingsPatch>)(
    "requires management when replacing or removing a transport: %j",
    (patch) => {
      expect(requiredScopesForServerSettingsPatch(patch, current)).toEqual([
        AuthSettingsWriteScope,
        AuthProvidersManageScope,
      ]);
    },
  );

  it.each([
    { name: "persisted", value: "", valueRedacted: true },
    { name: "materialized", value: "stored-secret", valueRedacted: true },
    { name: "inline", value: "stored-secret" },
  ])("accepts a retaining placeholder against a $name secret", ({ value, ...source }) => {
    const variable: McpServerVariable = { ...source, name: "TOKEN", sensitive: true, value };
    const settings = {
      ...current,
      projectSettingsOverrides: {
        [projectId]: {
          mcpServers: { tools: { enabled: true, transport: { ...transport, env: [variable] } } },
        },
      },
    };
    expect(requiredScopesForServerSettingsPatch(patchWithTransport(transport), settings)).toEqual([
      AuthSettingsWriteScope,
    ]);
  });

  it("does not equate different hidden credential inputs by redacting both sides", () => {
    const settings = {
      ...current,
      projectSettingsOverrides: {
        [projectId]: {
          mcpServers: {
            tools: {
              enabled: true,
              transport: {
                ...transport,
                env: [{ name: "TOKEN", sensitive: true, value: "original" }],
              },
            },
          },
        },
      },
    };
    expect(
      requiredScopesForServerSettingsPatch(
        patchWithTransport({
          ...transport,
          env: [{ name: "TOKEN", sensitive: true, value: "replacement", valueRedacted: true }],
        }),
        settings,
      ),
    ).toEqual([AuthSettingsWriteScope, AuthProvidersManageScope]);
  });

  it("compares HTTP URLs and headers while recognizing retained secrets", () => {
    const http: McpServerTransport = {
      type: "http",
      url: "https://example.com/mcp",
      headers: [
        { name: "Authorization", sensitive: true, value: "Bearer stored", valueRedacted: true },
      ],
    };
    const settings = {
      ...current,
      projectSettingsOverrides: {
        [projectId]: { mcpServers: { tools: { enabled: true, transport: http } } },
      },
    };
    const retained = {
      ...http,
      headers: [{ name: "Authorization", sensitive: true, value: "", valueRedacted: true }],
    };
    expect(requiredScopesForServerSettingsPatch(patchWithTransport(retained), settings)).toEqual([
      AuthSettingsWriteScope,
    ]);
    for (const next of [
      { ...retained, authentication: "oauth" as const },
      { ...retained, url: "https://other.example.com/mcp" },
      {
        ...retained,
        headers: [
          { name: "Authorization", sensitive: true, value: "Bearer changed", valueRedacted: true },
        ],
      },
      { ...retained, headers: [] },
    ]) {
      expect(requiredScopesForServerSettingsPatch(patchWithTransport(next), settings)).toEqual([
        AuthSettingsWriteScope,
        AuthProvidersManageScope,
      ]);
    }
  });

  it("conservatively requires management when the current snapshot is unavailable", () => {
    expect(requiredScopesForServerSettingsPatch(patchWithTransport(transport))).toEqual([
      AuthSettingsWriteScope,
      AuthProvidersManageScope,
    ]);
  });
});

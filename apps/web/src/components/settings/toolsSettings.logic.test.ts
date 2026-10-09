import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type McpServerConfig,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  collectSkillRows,
  createToolsSettingsWriter,
  listMcpServerRows,
  mcpServerDraftFrom,
  mcpServerFromDraft,
  parseArgs,
  parseMcpServerJson,
  formatArgs,
  takenMcpServerNames,
  withSkillDisabled,
} from "./toolsSettings.logic";

const provider = (
  instanceId: string,
  skills: ServerProvider["skills"],
  extra: Partial<ServerProvider> = {},
): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(instanceId),
    enabled: true,
    skills,
    ...extra,
  }) as ServerProvider;

describe("collectSkillRows", () => {
  it("keeps repository plugins directories separate from provider plugin installs", () => {
    const rows = collectSkillRows(
      [
        provider("codex", [
          {
            name: "repo-plugin",
            path: "/workspace/plugins/review/SKILL.md",
            scope: "project",
            enabled: true,
          },
          {
            name: "installed-plugin",
            path: "/home/me/.codex/plugins/review/SKILL.md",
            scope: "user",
            enabled: true,
          },
          {
            name: "declared-plugin",
            path: "/extensions/review/SKILL.md",
            scope: "plugin",
            enabled: true,
          },
        ]),
      ],
      null,
    );
    expect(Object.fromEntries(rows.map((row) => [row.name, row.group]))).toEqual({
      "repo-plugin": "project",
      "installed-plugin": "plugin",
      "declared-plugin": "plugin",
    });
  });

  it("merges one skill across providers and folders, grouped by its most specific location", () => {
    const rows = collectSkillRows(
      [
        provider("claudeAgent", [
          {
            name: "frontend-design",
            path: "/home/me/.claude/skills/frontend-design/SKILL.md",
            scope: "user",
            enabled: true,
          },
        ]),
        provider("codex", [
          {
            name: "frontend-design",
            path: "/home/me/.agents/skills/frontend-design/SKILL.md",
            scope: "user",
            enabled: true,
          },
          {
            name: "test-t3-app",
            path: "/work/t3/.agents/skills/test-t3-app/SKILL.md",
            scope: "repo",
            enabled: true,
          },
        ]),
        provider("cursor", [], { enabled: false }),
      ],
      null,
    );
    expect(
      rows.map((row) => [row.name, row.group, row.paths.length, row.providers.length]),
    ).toEqual([
      ["test-t3-app", "project", 1, 1],
      ["frontend-design", "personal", 2, 2],
    ]);
  });

  it("shows a skill as switched off by the provider only when every provider has it off", () => {
    const skill = (enabled: boolean) => ({
      name: "grill-me",
      path: "/home/me/.agents/skills/grill-me/SKILL.md",
      scope: "user",
      enabled,
    });
    expect(
      collectSkillRows([provider("a", [skill(false)]), provider("b", [skill(true)])], null)[0]
        ?.disabledByProvider,
    ).toBe(false);
    expect(collectSkillRows([provider("a", [skill(false)])], null)[0]?.disabledByProvider).toBe(
      true,
    );
  });
});

describe("listMcpServerRows", () => {
  const linear: McpServerConfig = {
    enabled: true,
    transport: { type: "http", url: "https://mcp.linear.app/mcp", headers: [] },
  };

  it("marks project servers, replacements and switched inherited servers", () => {
    const rows = listMcpServerRows({
      environment: { linear, sentry: linear },
      project: {
        linear: { enabled: true, transport: linear.transport },
        sentry: { enabled: false },
        gone: { enabled: false },
      },
    });
    expect(
      rows.map((row) => [row.name, row.origin, row.replacesEnvironment, row.config.enabled]),
    ).toEqual([
      ["linear", "project", true, true],
      ["sentry", "project-switch", false, false],
    ]);
  });
});

describe("MCP server drafts", () => {
  it("reads the JSON snippets vendors publish", () => {
    expect(
      parseMcpServerJson(
        JSON.stringify({
          mcpServers: {
            Supabase: {
              command: "npx",
              args: ["-y", "@supabase/mcp-server-supabase", "--project-ref=abc"],
              env: { SUPABASE_ACCESS_TOKEN: "sbp_123" },
            },
          },
        }),
      ),
    ).toMatchObject({
      name: "supabase",
      type: "stdio",
      command: "npx",
      args: "-y @supabase/mcp-server-supabase --project-ref=abc",
      env: [{ name: "SUPABASE_ACCESS_TOKEN", value: "sbp_123", sensitive: true }],
    });
    expect(
      parseMcpServerJson('{ "linear": { "url": "https://mcp.linear.app/mcp" } }'),
    ).toMatchObject({ name: "linear", type: "http", url: "https://mcp.linear.app/mcp" });
    // OpenCode's command array.
    expect(
      parseMcpServerJson('{ "type": "local", "command": ["bunx", "my-mcp", "--flag"] }'),
    ).toMatchObject({ type: "stdio", command: "bunx", args: "my-mcp --flag" });
    expect(parseMcpServerJson("not json")).toBeNull();
    expect(parseMcpServerJson('{ "theme": "dark" }')).toBeNull();
  });

  it("round-trips quoted arguments", () => {
    const args = ["--dir", "/Users/me/My Projects", 'say "hi"', ""];
    expect(parseArgs(formatArgs(args))).toEqual(args);
  });

  it("keeps a stored secret when the user leaves its value empty", () => {
    const draft = mcpServerDraftFrom("linear", {
      enabled: true,
      transport: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: [{ name: "Authorization", value: "", sensitive: true, valueRedacted: true }],
      },
    });
    const result = mcpServerFromDraft(draft, new Set());
    expect(result).toEqual({
      ok: true,
      name: "linear",
      transport: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: [{ name: "Authorization", value: "", sensitive: true, valueRedacted: true }],
      },
    });
  });

  it("rejects T3's own name, duplicates and missing commands", () => {
    const base = {
      ...mcpServerDraftFrom("x", {
        enabled: true,
        transport: { type: "stdio", command: "npx", args: [], env: [] },
      }),
    };
    expect(mcpServerFromDraft({ ...base, name: "t3-code" }, new Set())).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(mcpServerFromDraft({ ...base, name: "linear" }, new Set(["linear"]))).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(mcpServerFromDraft({ ...base, name: "ok", command: " " }, new Set())).toMatchObject({
      ok: false,
      field: "command",
    });
  });
});

describe("stored MCP credentials", () => {
  const config: McpServerConfig = {
    enabled: true,
    transport: {
      type: "http",
      url: "https://mcp.example.com",
      headers: [{ name: "Authorization", value: "", sensitive: true, valueRedacted: true }],
    },
  };
  const draft = () => mcpServerDraftFrom("example", config);

  it("requires replacement credentials when renaming a server or a stored variable", () => {
    const initial = draft();
    expect(mcpServerFromDraft({ ...initial, name: "renamed" }, new Set())).toMatchObject({
      ok: false,
      field: "name",
    });
    const renamedVariable = {
      ...initial,
      headers: initial.headers.map((entry) => ({ ...entry, name: "X-Api-Key" })),
    };
    expect(mcpServerFromDraft(renamedVariable, new Set())).toMatchObject({
      ok: false,
      field: "variables",
    });
    expect(
      mcpServerFromDraft(
        {
          ...renamedVariable,
          name: "renamed",
          headers: renamedVariable.headers.map((entry) => ({ ...entry, value: "replacement" })),
        },
        new Set(),
      ),
    ).toMatchObject({
      ok: true,
      name: "renamed",
      transport: { headers: [{ name: "X-Api-Key", value: "replacement", sensitive: true }] },
    });
  });

  it("blocks a stored secret made plain but preserves it when switched back", () => {
    const initial = draft();
    const plain = {
      ...initial,
      headers: initial.headers.map((entry) => ({ ...entry, sensitive: false })),
    };
    expect(mcpServerFromDraft(plain, new Set())).toMatchObject({ ok: false, field: "variables" });
    const restored = {
      ...plain,
      headers: plain.headers.map((entry) => ({ ...entry, sensitive: true })),
    };
    expect(mcpServerFromDraft(restored, new Set())).toMatchObject({
      ok: true,
      transport: config.transport,
    });
    expect(
      mcpServerFromDraft(
        { ...plain, headers: plain.headers.map((entry) => ({ ...entry, value: "replacement" })) },
        new Set(),
      ),
    ).toMatchObject({
      ok: true,
      transport: { headers: [{ name: "Authorization", value: "replacement", sensitive: false }] },
    });
  });

  it.each([
    undefined,
    { type: "http", url: "https://other.example.com", headers: [] } as const,
    {
      type: "http",
      url: "https://other.example.com",
      headers: [{ name: "Authorization", sensitive: false, value: "plain" }],
    } as const,
    { type: "stdio", command: "example", args: [], env: [] } as const,
  ])("requires a replacement if any destination lacks the stored credential (%j)", (other) => {
    expect(mcpServerFromDraft(draft(), new Set(), [config.transport, other])).toMatchObject({
      ok: false,
      field: "variables",
    });
    const replacement = {
      ...draft(),
      headers: draft().headers.map((entry) => ({ ...entry, value: "new-secret" })),
    };
    expect(mcpServerFromDraft(replacement, new Set(), [config.transport, other]).ok).toBe(true);
  });

  it("preserves each target's own stored secret when every target already has it", () => {
    expect(mcpServerFromDraft(draft(), new Set(), [config.transport, config.transport])).toEqual({
      ok: true,
      name: "example",
      transport: config.transport,
    });
  });

  it("applies stored-secret identity checks to command environment variables", () => {
    const initial = mcpServerDraftFrom("example", {
      enabled: true,
      transport: {
        type: "stdio",
        command: "example",
        args: [],
        env: [{ name: "API_KEY", value: "", sensitive: true, valueRedacted: true }],
      },
    });
    expect(
      mcpServerFromDraft(
        { ...initial, env: initial.env.map((entry) => ({ ...entry, name: "TOKEN" })) },
        new Set(),
      ),
    ).toMatchObject({ ok: false, field: "variables" });
    expect(mcpServerFromDraft(initial, new Set(), [undefined])).toMatchObject({
      ok: false,
      field: "variables",
    });
  });

  it("does not silently remove unnamed stored variables or accept duplicate headers", () => {
    const initial = draft();
    expect(
      mcpServerFromDraft(
        { ...initial, headers: initial.headers.map((entry) => ({ ...entry, name: " " })) },
        new Set(),
      ),
    ).toMatchObject({ ok: false, field: "variables" });
    expect(
      mcpServerFromDraft(
        {
          ...initial,
          headers: [
            ...initial.headers,
            {
              id: "new",
              name: "authorization",
              value: "duplicate",
              sensitive: false,
              stored: false,
            },
          ],
        },
        new Set(),
      ),
    ).toMatchObject({ ok: false, field: "variables" });
  });

  it("rejects names present only on another target when adding or renaming", () => {
    const targets: ReadonlyArray<Record<string, McpServerConfig>> = [
      { example: config },
      { remote: config },
    ];
    const taken = takenMcpServerNames(targets, "example");
    expect(taken.has("example")).toBe(false);
    expect(mcpServerFromDraft({ ...draft(), name: "remote", headers: [] }, taken)).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(
      mcpServerFromDraft({ ...draft(), headers: [] }, takenMcpServerNames(targets)),
    ).toMatchObject({ ok: false, field: "name" });
  });
});

describe("Tools writes", () => {
  const environmentId = EnvironmentId.make("local");
  const disable =
    (name: string) =>
    (settings: ServerSettings): ServerSettingsPatch => ({
      disabledSkills: withSkillDisabled(settings.disabledSkills, name, true),
    });

  it("serializes rapid changes against saved settings before their subscription push arrives", async () => {
    let saved = DEFAULT_SERVER_SETTINGS;
    let resolveFirst!: (settings: ServerSettings | null) => void;
    const first = new Promise<ServerSettings | null>((resolve) => {
      resolveFirst = resolve;
    });
    const write = vi.fn(
      async (
        _environmentId: EnvironmentId,
        patch: ServerSettingsPatch,
      ): Promise<ServerSettings | null> => {
        saved = applyServerSettingsPatch(saved, patch);
        return write.mock.calls.length === 1 ? first : saved;
      },
    );
    const persist = createToolsSettingsWriter(() => DEFAULT_SERVER_SETTINGS, write);
    const one = persist(environmentId, disable("one"));
    const two = persist(environmentId, disable("two"));
    const three = persist(environmentId, disable("three"));
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    resolveFirst(saved);
    await Promise.all([one, two, three]);
    expect(saved.disabledSkills).toEqual(["one", "three", "two"]);
  });

  it("ignores late intermediate pushes instead of rolling back newer saved changes", async () => {
    let source = DEFAULT_SERVER_SETTINGS;
    let saved = DEFAULT_SERVER_SETTINGS;
    const persist = createToolsSettingsWriter(
      () => source,
      async (_environmentId, patch) => {
        saved = applyServerSettingsPatch(saved, patch);
        return saved;
      },
    );
    await persist(environmentId, disable("first"));
    const firstSnapshot = saved;
    await persist(environmentId, disable("second"));
    source = { ...firstSnapshot };
    await persist(environmentId, disable("third"));
    expect(saved.disabledSkills).toEqual(["first", "second", "third"]);
    // Once the subscription catches up, an external edit must remain authoritative.
    source = { ...saved };
    await persist(environmentId, () => null);
    source = saved = { ...saved, disabledSkills: ["external"] };
    await persist(environmentId, disable("next"));
    expect(saved.disabledSkills).toEqual(["external", "next"]);
  });

  it("preserves consecutive edits to a project entry and multiple checkouts on one environment", async () => {
    let saved = DEFAULT_SERVER_SETTINGS;
    const persist = createToolsSettingsWriter(
      () => DEFAULT_SERVER_SETTINGS,
      async (_environmentId, patch) => {
        saved = applyServerSettingsPatch(saved, patch);
        return saved;
      },
    );
    const change = (projectId: ProjectId, name: string) =>
      persist(environmentId, (settings) => ({
        projectSettingsOverrides: {
          [projectId]: {
            ...settings.projectSettingsOverrides[projectId],
            disabledSkills: {
              ...settings.projectSettingsOverrides[projectId]?.disabledSkills,
              [name]: true,
            },
          },
        },
      }));
    await Promise.all([
      change(ProjectId.make("one"), "first"),
      change(ProjectId.make("one"), "second"),
      change(ProjectId.make("two"), "third"),
    ]);
    expect(saved.projectSettingsOverrides).toMatchObject({
      one: { disabledSkills: { first: true, second: true } },
      two: { disabledSkills: { third: true } },
    });
  });

  it("does not carry failed changes into the next write, and adopts newer subscribed settings", async () => {
    let source = DEFAULT_SERVER_SETTINGS;
    let saved = DEFAULT_SERVER_SETTINGS;
    let fail = true;
    const persist = createToolsSettingsWriter(
      () => source,
      async (_environmentId, patch) => {
        if (fail) {
          fail = false;
          return null;
        }
        saved = applyServerSettingsPatch(saved, patch);
        return saved;
      },
    );
    await Promise.all([
      persist(environmentId, disable("failed")),
      persist(environmentId, disable("saved")),
    ]);
    expect(saved.disabledSkills).toEqual(["saved"]);
    source = saved = { ...saved, disabledSkills: ["external"] };
    await persist(environmentId, disable("next"));
    expect(saved.disabledSkills).toEqual(["external", "next"]);
  });
});

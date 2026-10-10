import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  collectSkillRows,
  createToolsSettingsWriter,
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

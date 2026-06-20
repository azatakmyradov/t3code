import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { DEFAULT_JIRA_PAGE_FILTERS } from "./forkJira.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ClientSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin off for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(false);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: true }).newWorktreesStartFromOrigin,
    ).toBe(true);
  });
});

describe("ServerSettings.fork.snippets", () => {
  it("defaults to an empty snippet list", () => {
    expect(DEFAULT_SERVER_SETTINGS.fork.snippets).toEqual([]);
  });

  it("decodes legacy settings without fork settings", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.fork.snippets).toEqual([]);
  });

  it("decodes legacy fork settings without snippets", () => {
    const decoded = decodeServerSettings({ fork: {} });
    expect(decoded.fork.snippets).toEqual([]);
  });

  it("decodes valid snippets and normalizes keywords", () => {
    const decoded = decodeServerSettings({
      fork: {
        snippets: [
          { keyword: "  :Bug_Fix  ", value: "  Please fix this bug.  " },
          { keyword: "review-notes", value: "Review the diff." },
        ],
      },
    });

    expect(decoded.fork.snippets).toEqual([
      { keyword: "bug_fix", value: "Please fix this bug." },
      { keyword: "review-notes", value: "Review the diff." },
    ]);
  });

  it("rejects invalid snippet keywords", () => {
    expect(() =>
      decodeServerSettings({
        fork: { snippets: [{ keyword: "bad keyword", value: "valid value" }] },
      }),
    ).toThrow();
  });

  it("rejects empty snippet values", () => {
    expect(() =>
      decodeServerSettings({
        fork: { snippets: [{ keyword: "bug", value: "   " }] },
      }),
    ).toThrow();
  });

  it("rejects duplicate snippet keywords after normalization", () => {
    expect(() =>
      decodeServerSettings({
        fork: {
          snippets: [
            { keyword: ":Bug", value: "First" },
            { keyword: "bug", value: "Second" },
          ],
        },
      }),
    ).toThrow();
  });

  it("decodes snippet whole-array replacement patches", () => {
    const patch = decodeServerSettingsPatch({
      fork: { snippets: [{ keyword: ":Bug", value: " Fix it " }] },
    });

    expect(patch.fork?.snippets).toEqual([{ keyword: "bug", value: "Fix it" }]);
  });

  it("trims and normalizes encoded snippet settings", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      fork: {
        ...defaultSettings.fork,
        snippets: [{ keyword: "  :Bug  ", value: "  Fix it exactly.  " }],
      },
    });

    expect(encoded.fork?.snippets).toEqual([{ keyword: "bug", value: "Fix it exactly." }]);
  });
});

describe("ServerSettings.fork.reviewGroupsDefaultMode", () => {
  it("defaults to groups for legacy configs", () => {
    expect(decodeServerSettings({}).fork.reviewGroupsDefaultMode).toBe("groups");
    expect(decodeServerSettings({ fork: {} }).fork.reviewGroupsDefaultMode).toBe("groups");
  });

  it("accepts files in fork settings patches", () => {
    const patch = decodeServerSettingsPatch({
      fork: { reviewGroupsDefaultMode: "files" },
    });

    expect(patch.fork?.reviewGroupsDefaultMode).toBe("files");
  });

  it("rejects invalid values", () => {
    expect(() =>
      decodeServerSettings({
        fork: { reviewGroupsDefaultMode: "side-by-side" },
      }),
    ).toThrow();
    expect(() =>
      decodeServerSettingsPatch({
        fork: { reviewGroupsDefaultMode: "side-by-side" },
      }),
    ).toThrow();
  });
});

describe("ServerSettings.fork.jira", () => {
  it("defaults Jira settings for legacy configs", () => {
    const decoded = decodeServerSettings({});

    expect(DEFAULT_SERVER_SETTINGS.fork.jira).toEqual({
      siteUrl: "",
      email: "",
      apiToken: "",
    });
    expect(decoded.fork.jira).toEqual(DEFAULT_SERVER_SETTINGS.fork.jira);
  });

  it("decodes Jira settings patches without retaining legacy default JQL", () => {
    const patch = decodeServerSettingsPatch({
      fork: {
        jira: {
          siteUrl: " https://example.atlassian.net ",
          email: " ada@example.com ",
          apiToken: " token ",
          apiTokenRedacted: true,
          defaultJql: " project = ABC ",
        },
      },
    });

    expect(patch.fork?.jira).toEqual({
      siteUrl: " https://example.atlassian.net ",
      email: " ada@example.com ",
      apiToken: " token ",
      apiTokenRedacted: true,
    });
  });

  it("encodes the Jira token redaction shape", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      fork: {
        ...defaultSettings.fork,
        jira: {
          siteUrl: "https://example.atlassian.net",
          email: "ada@example.com",
          apiToken: "",
          apiTokenRedacted: true,
        },
      },
    });

    expect(encoded.fork?.jira).toEqual({
      siteUrl: "https://example.atlassian.net",
      email: "ada@example.com",
      apiToken: "",
      apiTokenRedacted: true,
    });
  });
});

describe("ClientSettings.jiraPageFilters", () => {
  it("defaults Jira page filters to the legacy assigned unresolved issue scope", () => {
    const decoded = decodeClientSettings({});

    expect(DEFAULT_CLIENT_SETTINGS.jiraPageFilters).toEqual(DEFAULT_JIRA_PAGE_FILTERS);
    expect(decoded.jiraPageFilters).toEqual({
      space: "",
      status: "unresolved",
      assignee: "currentUser",
      updated: "any",
      sort: "updatedDesc",
    });
  });

  it("decodes Jira page filter patches", () => {
    const patch = decodeClientSettingsPatch({
      jiraPageFilters: {
        search: " deploy ",
        requestType: "bug",
        space: " REBELSCAN ",
        status: "inProgress",
        assignee: "unassigned",
        updated: "7d",
        sort: "createdDesc",
      },
    });

    expect(patch.jiraPageFilters).toEqual({
      space: "REBELSCAN",
      status: "inProgress",
      assignee: "unassigned",
      updated: "7d",
      sort: "createdDesc",
    });
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
        },
      },
      fork: {
        ...defaultSettings.fork,
        snippets: [{ keyword: "  :Bug  ", value: "  Fix it  " }],
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.fork?.snippets).toEqual([{ keyword: "bug", value: "Fix it" }]);
  });
});

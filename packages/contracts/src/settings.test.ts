import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings.ts";

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

describe("ServerSettings.builderModelSelection", () => {
  it("defaults legacy settings to the coding model", () => {
    const decoded = decodeServerSettings({});

    expect(decoded.builderModelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    });
  });

  it("trims builder selection patches", () => {
    const patch = decodeServerSettingsPatch({
      builderModelSelection: {
        instanceId: "  codex  ",
        model: "  gpt-5.4  ",
        options: [{ id: "  reasoningEffort  ", value: "  high  " }],
      },
    });

    expect(patch.builderModelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });

  it("normalizes encoded builder strings and options", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      builderModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "  gpt-5.4  ",
        options: [{ id: "  reasoningEffort  ", value: "  high  " }],
      },
    });

    expect(encoded.builderModelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });
});

describe("ServerSettings.snippets", () => {
  it("defaults to an empty snippet list", () => {
    expect(DEFAULT_SERVER_SETTINGS.snippets).toEqual([]);
  });

  it("decodes legacy settings without snippets", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.snippets).toEqual([]);
  });

  it("decodes valid snippets and normalizes keywords", () => {
    const decoded = decodeServerSettings({
      snippets: [
        { keyword: "  :Bug_Fix  ", value: "  Please fix this bug.  " },
        { keyword: "review-notes", value: "Review the diff." },
      ],
    });

    expect(decoded.snippets).toEqual([
      { keyword: "bug_fix", value: "Please fix this bug." },
      { keyword: "review-notes", value: "Review the diff." },
    ]);
  });

  it("rejects invalid snippet keywords", () => {
    expect(() =>
      decodeServerSettings({
        snippets: [{ keyword: "bad keyword", value: "valid value" }],
      }),
    ).toThrow();
  });

  it("rejects empty snippet values", () => {
    expect(() =>
      decodeServerSettings({
        snippets: [{ keyword: "bug", value: "   " }],
      }),
    ).toThrow();
  });

  it("rejects duplicate snippet keywords after normalization", () => {
    expect(() =>
      decodeServerSettings({
        snippets: [
          { keyword: ":Bug", value: "First" },
          { keyword: "bug", value: "Second" },
        ],
      }),
    ).toThrow();
  });

  it("decodes snippet whole-array replacement patches", () => {
    const patch = decodeServerSettingsPatch({
      snippets: [{ keyword: ":Bug", value: " Fix it " }],
    });

    expect(patch.snippets).toEqual([{ keyword: "bug", value: "Fix it" }]);
  });

  it("trims and normalizes encoded snippet settings", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      snippets: [{ keyword: "  :Bug  ", value: "  Fix it exactly.  " }],
    });

    expect(encoded.snippets).toEqual([{ keyword: "bug", value: "Fix it exactly." }]);
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
      builderModelSelection: { model: "  gpt-5.4  " },
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
    expect(patch.builderModelSelection?.model).toBe("gpt-5.4");
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
      snippets: [{ keyword: "  :Bug  ", value: "  Fix it  " }],
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.snippets).toEqual([{ keyword: "bug", value: "Fix it" }]);
  });
});

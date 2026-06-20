import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { resolveForkBuilderModelSelection } from "./builderImplementation";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
  };
}

function model(
  slug: string,
  options?: {
    readonly name?: string;
    readonly descriptors?: ReadonlyArray<ProviderOptionDescriptor>;
  },
): ServerProviderModel {
  return {
    slug,
    name: options?.name ?? slug,
    isCustom: false,
    capabilities: options?.descriptors ? { optionDescriptors: options.descriptors } : {},
  };
}

function provider(input: {
  readonly instanceId: string;
  readonly driver?: ProviderDriverKind;
  readonly enabled?: boolean;
  readonly availability?: ServerProvider["availability"];
  readonly models?: ReadonlyArray<ServerProviderModel>;
}): ServerProvider {
  const driver = input.driver ?? CODEX;
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver,
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...(input.availability ? { availability: input.availability } : {}),
    models: input.models ?? [model("gpt-5.4")],
    slashCommands: [],
    skills: [],
  };
}

function settingsWithBuilder(
  builderModelSelection: UnifiedSettings["fork"]["builderModelSelection"],
  overrides?: Partial<UnifiedSettings>,
): UnifiedSettings {
  return {
    ...DEFAULT_UNIFIED_SETTINGS,
    ...overrides,
    fork: {
      ...DEFAULT_UNIFIED_SETTINGS.fork,
      ...overrides?.fork,
      builderModelSelection,
    },
  };
}

describe("resolveForkBuilderModelSelection", () => {
  it("returns null when builder model is unset", () => {
    expect(
      resolveForkBuilderModelSelection(settingsWithBuilder(null), [
        provider({ instanceId: "codex" }),
      ]),
    ).toBeNull();
  });

  it("returns a normalized selection for an enabled available instance", () => {
    const selection = resolveForkBuilderModelSelection(
      settingsWithBuilder({
        instanceId: ProviderInstanceId.make("codex"),
        model: "GPT 5.4",
      }),
      [provider({ instanceId: "codex", models: [model("gpt-5.4", { name: "GPT 5.4" })] })],
    );

    expect(selection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    });
  });

  it("preserves explicit options and rebuilds descriptor defaults", () => {
    const selection = resolveForkBuilderModelSelection(
      settingsWithBuilder({
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [{ id: "effort", value: "low" }],
      }),
      [
        provider({
          instanceId: "codex",
          models: [
            model("gpt-5.4", {
              descriptors: [
                selectDescriptor("effort", [
                  { id: "low", label: "Low" },
                  { id: "high", label: "High", isDefault: true },
                ]),
                selectDescriptor("contextWindow", [
                  { id: "200k", label: "200K", isDefault: true },
                  { id: "1m", label: "1M" },
                ]),
              ],
            }),
          ],
        }),
      ],
    );

    expect(selection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [
        { id: "effort", value: "low" },
        { id: "contextWindow", value: "200k" },
      ],
    });
  });

  it("returns null for a missing configured instance", () => {
    expect(
      resolveForkBuilderModelSelection(
        settingsWithBuilder({
          instanceId: ProviderInstanceId.make("codex_personal"),
          model: "gpt-5.4",
        }),
        [provider({ instanceId: "codex" })],
      ),
    ).toBeNull();
  });

  it("returns null for a disabled configured instance", () => {
    const instanceId = ProviderInstanceId.make("codex_personal");

    expect(
      resolveForkBuilderModelSelection(
        settingsWithBuilder(
          {
            instanceId,
            model: "gpt-5.4",
          },
          {
            providerInstances: {
              [instanceId]: {
                driver: CODEX,
                enabled: false,
                config: {},
              },
            },
          },
        ),
        [provider({ instanceId })],
      ),
    ).toBeNull();
  });

  it("returns null for an unavailable configured instance", () => {
    expect(
      resolveForkBuilderModelSelection(
        settingsWithBuilder({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
        [provider({ instanceId: "codex", availability: "unavailable" })],
      ),
    ).toBeNull();
  });

  it("does not fall back silently to another provider or model", () => {
    expect(
      resolveForkBuilderModelSelection(
        settingsWithBuilder({
          instanceId: ProviderInstanceId.make("codex"),
          model: "claude-opus-4-6",
        }),
        [
          provider({ instanceId: "codex", models: [model("gpt-5.4")] }),
          provider({
            instanceId: "claudeAgent",
            driver: CLAUDE,
            models: [model("claude-opus-4-6")],
          }),
        ],
      ),
    ).toBeNull();
  });
});

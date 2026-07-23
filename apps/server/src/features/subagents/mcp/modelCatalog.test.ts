import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeSubagentModelCatalog } from "./modelCatalog.ts";

const provider = (
  overrides: Omit<Partial<ServerProvider>, "instanceId" | "driver"> & {
    readonly instanceId: string;
    readonly driver: string;
  },
): ServerProvider =>
  ({
    displayName: undefined,
    enabled: true,
    installed: true,
    availability: "available",
    models: [],
    ...overrides,
  }) as unknown as ServerProvider;

describe("makeSubagentModelCatalog", () => {
  it("lists only spawnable Codex and Claude models with supported effort values", () => {
    const catalog = makeSubagentModelCatalog([
      provider({
        instanceId: "codex_work",
        driver: "codex",
        displayName: "Work Codex",
        models: [
          {
            slug: "gpt-test",
            name: "GPT Test",
            isCustom: false,
            capabilities: {
              optionDescriptors: [
                {
                  id: "reasoningEffort",
                  label: "Reasoning",
                  type: "select",
                  currentValue: "high",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "high", label: "High" },
                    { id: "future", label: "Future" },
                  ],
                },
              ],
            },
          },
        ],
      }),
      provider({
        instanceId: "claude",
        driver: "claudeAgent",
        models: [
          {
            slug: "claude-test",
            name: "Claude Test",
            isCustom: false,
            isDefault: true,
            capabilities: {
              optionDescriptors: [
                {
                  id: "effort",
                  label: "Effort",
                  type: "select",
                  options: [
                    { id: "medium", label: "Medium", isDefault: true },
                    { id: "max", label: "Max" },
                  ],
                },
              ],
            },
          },
        ],
      }),
      provider({
        instanceId: "codex_disabled",
        driver: "codex",
        enabled: false,
        models: [
          {
            slug: "hidden",
            name: "Hidden",
            isCustom: false,
            capabilities: null,
          },
        ],
      }),
      provider({
        instanceId: "cursor",
        driver: "cursor",
        models: [
          {
            slug: "cursor-model",
            name: "Cursor Model",
            isCustom: false,
            capabilities: null,
          },
        ],
      }),
    ]);

    expect(catalog).toEqual({
      providers: [
        {
          agent: "codex",
          provider_instance_id: "codex_work",
          provider_name: "Work Codex",
          models: [
            {
              model: "gpt-test",
              name: "GPT Test",
              is_default: true,
              reasoning_efforts: ["low", "high"],
              default_reasoning_effort: "high",
            },
          ],
        },
        {
          agent: "claude",
          provider_instance_id: "claude",
          provider_name: "Claude",
          models: [
            {
              model: "claude-test",
              name: "Claude Test",
              is_default: true,
              reasoning_efforts: ["medium", "max"],
              default_reasoning_effort: "medium",
            },
          ],
        },
      ],
    });
  });

  it("omits unavailable and model-less providers", () => {
    const catalog = makeSubagentModelCatalog([
      provider({
        instanceId: "codex_unavailable",
        driver: "codex",
        availability: "unavailable",
      }),
      provider({
        instanceId: "claude_empty",
        driver: "claudeAgent",
      }),
    ]);

    expect(catalog).toEqual({ providers: [] });
  });
});

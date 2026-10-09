import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ServerConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { remoteBotTaskModel } from "./botTaskModel";

describe("remoteBotTaskModel", () => {
  const codex = ProviderInstanceId.make("codex");
  const project = { id: ProjectId.make("project") };
  const environmentSelection = { instanceId: codex, model: "environment-model" };
  const config = {
    settings: { ...DEFAULT_SERVER_SETTINGS, defaultModelSelection: environmentSelection },
    providers: [
      {
        instanceId: codex,
        driver: "codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        models: [
          { slug: "environment-model", name: "Environment", isCustom: false, capabilities: null },
          { slug: "bot-model", name: "Bot", isCustom: false, capabilities: null },
        ],
      },
    ],
  } as unknown as ServerConfig;

  it("keeps the bot's model when the environment has its provider instance", () => {
    const botSelection = { instanceId: codex, model: "bot-model" };
    expect(remoteBotTaskModel(config, botSelection, project)).toBe(botSelection);
  });

  it("uses the environment's default when the bot's provider instance is missing there", () => {
    const botSelection = { instanceId: ProviderInstanceId.make("work-claude"), model: "opus" };
    expect(remoteBotTaskModel(config, botSelection, project)).toEqual(environmentSelection);
  });

  it("has no default until the environment's config loads", () => {
    expect(remoteBotTaskModel(null, { instanceId: codex, model: "bot-model" }, project)).toBeNull();
  });
});

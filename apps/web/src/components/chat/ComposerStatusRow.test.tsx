// @vitest-environment jsdom

import { act } from "react";
import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { TooltipProvider } from "../ui/tooltip";
import { ComposerStatusRow } from "./ComposerStatusRow";

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-10-10T12:00" }));

it("updates reported metrics and clears another account's values when switching or disconnecting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const selectedModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
  const context = deriveLatestContextWindowSnapshot([], {
    usedTokens: 10_000,
    maxTokens: 200_000,
    updatedAt: "2026-10-10T11:59:00Z",
  });
  const render = async (reported: boolean, disconnected = false, showContext = true) => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <ComposerStatusRow
            provider={
              reported
                ? {
                    instanceId: selectedModel.instanceId,
                    driver: ProviderDriverKind.make("codex"),
                    usageLimits: {
                      checkedAt: "2026-10-10T11:59:00Z",
                      windows: [
                        {
                          id: "primary",
                          kind: "session",
                          label: "Session",
                          windowDurationMins: 300,
                          usedPercent: 12,
                        },
                      ],
                    },
                  }
                : null
            }
            selectedModel={selectedModel}
            context={reported ? context : null}
            contextModelSelection={reported ? selectedModel : null}
            showContext={showContext}
            throughput={
              reported
                ? {
                    providerInstanceId: selectedModel.instanceId,
                    modelSelection: selectedModel,
                    tokensPerSecond: 91,
                    outputTokens: 910,
                    durationMs: 10_000,
                  }
                : null
            }
            disconnected={disconnected}
          />
        </TooltipProvider>,
      );
    });
  };
  try {
    await render(true);
    expect(container.textContent).toContain("5h12%");
    expect(container.textContent).toContain("5% context");
    expect(container.textContent).toContain("91 tok/s turn avg");
    await render(false);
    expect(container.textContent).toContain("Quota —");
    expect(container.textContent).toContain("— context");
    expect(container.textContent).toContain("— tok/s turn avg");
    expect(container.textContent).not.toContain("12%");
    await render(true, true);
    expect(container.textContent).not.toContain("12%");
    expect(container.textContent).not.toContain("91 tok/s");
    await render(true, false, false);
    expect(container.textContent).not.toContain("context");
    expect(container.textContent).toContain("91 tok/s turn avg");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("follows provider and model picks immediately while their new telemetry is still loading", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const opus = { instanceId: ProviderInstanceId.make("claude-work"), model: "claude-opus-5-5" };
  const sonnet = { ...opus, model: "claude-sonnet-5-5" };
  const codex = { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5" };
  const claudeProvider = {
    instanceId: opus.instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    usageLimits: {
      checkedAt: "2026-10-10T11:59:00Z",
      windows: [
        {
          id: "five_hour",
          kind: "session" as const,
          label: "Session",
          windowDurationMins: 300,
          usedPercent: 12,
        },
        { id: "seven_day", kind: "weekly" as const, label: "Weekly", usedPercent: 62 },
        { id: "seven_day_opus", kind: "weekly" as const, label: "Weekly · Opus", usedPercent: 71 },
        {
          id: "seven_day_sonnet",
          kind: "weekly" as const,
          label: "Weekly · Sonnet",
          usedPercent: 84,
        },
      ],
    },
  };
  const codexProvider = {
    ...claudeProvider,
    instanceId: codex.instanceId,
    driver: ProviderDriverKind.make("codex"),
    usageLimits: {
      ...claudeProvider.usageLimits,
      windows: [
        {
          id: "primary",
          kind: "session" as const,
          label: "Session",
          windowDurationMins: 300,
          usedPercent: 34,
        },
      ],
    },
  };
  const context = deriveLatestContextWindowSnapshot([], {
    usedTokens: 10_000,
    maxTokens: 200_000,
    updatedAt: "2026-10-10T11:59:00Z",
  });
  const render = async (
    selectedModel: ModelSelection,
    provider = claudeProvider,
    reportedModel = opus,
  ) => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <ComposerStatusRow
            provider={provider}
            selectedModel={selectedModel}
            context={context}
            contextModelSelection={reportedModel}
            showContext
            throughput={{
              providerInstanceId: reportedModel.instanceId,
              modelSelection: reportedModel,
              tokensPerSecond: 91,
              outputTokens: 910,
              durationMs: 10_000,
            }}
            disconnected={false}
          />
        </TooltipProvider>,
      );
    });
  };
  try {
    await render(opus);
    expect(container.textContent).toContain("5h12%");
    expect(container.textContent).toContain("Week62%");
    expect(container.textContent).toContain("Week · Opus71%");
    expect(container.textContent).not.toContain("Sonnet");
    await render(sonnet);
    expect(container.textContent).toContain("Week · Sonnet84%");
    expect(container.textContent).not.toContain("Opus");
    expect(container.textContent).toContain("— context");
    expect(container.textContent).toContain("— tok/s turn avg");
    await render(codex);
    expect(container.textContent).toContain("Quota —");
    expect(container.textContent).not.toMatch(/12%|62%|71%|84%/);
    await render(codex, codexProvider);
    expect(container.textContent).toContain("5h34%");
    expect(container.textContent).toContain("— context");
    expect(container.textContent).toContain("— tok/s turn avg");
    await render(codex, codexProvider, codex);
    expect(container.textContent).toContain("5% context");
    expect(container.textContent).toContain("91 tok/s turn avg");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

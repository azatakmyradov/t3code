// @vitest-environment jsdom

import { act } from "react";
import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { NO_PROVIDER_MODEL_SELECTION } from "../../providerInstances";
import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { TooltipProvider } from "../ui/tooltip";
import { ProviderUsageSection } from "./ProviderUsageSection";

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-10-10T12:00" }));

it("updates reported metrics and clears another account's values when switching or disconnecting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
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
          <ProviderUsageSection
            host={host}
            multipleModels={false}
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
    expect(host.textContent).toContain("5h12%");
    expect(host.textContent).toContain("Context5%");
    expect(host.textContent).toContain("Turn average91 tok/s");
    await render(false);
    expect(host.textContent).toContain("QuotaUnavailable");
    expect(host.textContent).toContain("Context—");
    expect(host.textContent).toContain("Turn average— tok/s");
    expect(host.textContent).not.toContain("12%");
    await render(true, true);
    expect(host.textContent).not.toContain("12%");
    expect(host.textContent).not.toContain("91 tok/s");
    await render(true, false, false);
    expect(host.textContent).not.toContain("Context");
    expect(host.textContent).toContain("Turn average91 tok/s");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("follows provider and model picks immediately while their new telemetry is still loading", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
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
          <ProviderUsageSection
            host={host}
            multipleModels={false}
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
    expect(host.textContent).toContain("5h12%");
    expect(host.textContent).toContain("Week62%");
    expect(host.textContent).toContain("Week · Opus71%");
    expect(host.textContent).not.toContain("Sonnet");
    await render(sonnet);
    expect(host.textContent).toContain("Week · Sonnet84%");
    expect(host.textContent).not.toContain("Opus");
    expect(host.textContent).toContain("Context—");
    expect(host.textContent).toContain("Turn average— tok/s");
    await render(codex);
    expect(host.textContent).toContain("QuotaUnavailable");
    expect(host.textContent).not.toMatch(/12%|62%|71%|84%/);
    await render(codex, codexProvider);
    expect(host.textContent).toContain("5h34%");
    expect(host.textContent).toContain("Context—");
    expect(host.textContent).toContain("Turn average— tok/s");
    await render(codex, codexProvider, codex);
    expect(host.textContent).toContain("Context5%");
    expect(host.textContent).toContain("Turn average91 tok/s");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("stays outside the composer and follows closing, reopening, and changing the card host", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const composer = document.createElement("form");
  const sidebar = document.createElement("div");
  const popover = document.createElement("div");
  document.body.append(composer, sidebar, popover);
  const root = createRoot(composer);
  const selectedModel = { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5" };
  const render = async (host: HTMLDivElement | null, multipleModels = false) => {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <ProviderUsageSection
            host={host}
            multipleModels={multipleModels}
            provider={{
              instanceId: selectedModel.instanceId,
              driver: ProviderDriverKind.make("codex"),
              displayName: "Codex Work",
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
            }}
            selectedModel={selectedModel}
            context={null}
            contextModelSelection={null}
            showContext
            throughput={null}
            disconnected={false}
          />
        </TooltipProvider>,
      ),
    );
  };
  try {
    await render(sidebar);
    expect(composer.textContent).toBe("");
    expect(sidebar.textContent).toContain("Codex Work5h12%");
    await render(null);
    expect(sidebar.textContent).toBe("");
    await render(popover);
    expect(sidebar.textContent).toBe("");
    expect(popover.textContent).toContain("Codex Work5h12%");
    await render(popover, true);
    expect(popover.textContent).toContain("Select one model to see its usage.");
    expect(popover.textContent).not.toContain("12%");
    await render(sidebar);
    expect(popover.textContent).toBe("");
    expect(sidebar.textContent).toContain("5h12%");
    expect(composer.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    composer.remove();
    sidebar.remove();
    popover.remove();
    vi.unstubAllGlobals();
  }
});

it("shows a readable empty state when providers are disabled and recovers when one is selected", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
  const root = createRoot(container);
  const selectedModel = { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5" };
  const render = async (enabled: boolean) => {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <ProviderUsageSection
            host={host}
            multipleModels={false}
            provider={
              enabled
                ? {
                    instanceId: selectedModel.instanceId,
                    driver: ProviderDriverKind.make("codex"),
                    displayName: "Codex Work",
                  }
                : null
            }
            selectedModel={enabled ? selectedModel : NO_PROVIDER_MODEL_SELECTION}
            context={null}
            contextModelSelection={null}
            showContext
            throughput={null}
            disconnected={false}
          />
        </TooltipProvider>,
      ),
    );
  };
  try {
    await render(true);
    expect(host.textContent).toContain("Codex Work");
    await render(false);
    expect(host.textContent).toBe("Provider usageNo provider selected");
    expect(host.textContent).not.toContain("t3code_no_provider");
    expect(host.textContent).not.toContain("Codex Work");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    await render(true);
    expect(host.textContent).toContain("Codex Work");
    expect(host.textContent).not.toContain("No provider selected");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    host.remove();
    vi.unstubAllGlobals();
  }
});

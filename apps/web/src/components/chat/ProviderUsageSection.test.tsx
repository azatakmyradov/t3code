// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import {
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
} from "../../providerInstances";
import { TooltipProvider } from "../ui/tooltip";
import { ProviderUsageSection } from "./ProviderUsageSection";
import { selectConfiguredUsageProviders } from "./providerUsage.logic";

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-10-10T12:00" }));

function provider(id: string, name: string, percent: number, extra: Partial<ServerProvider> = {}) {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    displayName: name,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-10T11:59:00Z",
    models: [],
    skills: [],
    slashCommands: [],
    usageLimits: {
      checkedAt: "2026-10-10T11:59:00Z",
      windows: [
        {
          id: "primary",
          kind: "session",
          label: "Session",
          windowDurationMins: 300,
          usedPercent: percent,
        },
      ],
    },
    ...extra,
  } satisfies ServerProvider;
}
const codex = provider("codex", "Codex", 12);
const personal = provider("codex-personal", "Codex Personal", 34);
const claude = provider("claude-work", "Claude Work", 56, {
  driver: ProviderDriverKind.make("claudeAgent"),
  usageLimits: {
    checkedAt: "2026-10-10T11:59:00Z",
    windows: [
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        windowDurationMins: 300,
        usedPercent: 56,
      },
      { id: "seven_day_opus", kind: "weekly", label: "Weekly · Opus", usedPercent: 71 },
      { id: "seven_day_sonnet", kind: "weekly", label: "Weekly · Sonnet", usedPercent: 84 },
    ],
  },
});
const selectedModel = { instanceId: claude.instanceId, model: "claude-opus-5-5" };
const context = deriveLatestContextWindowSnapshot([], {
  usedTokens: 10_000,
  maxTokens: 200_000,
  updatedAt: "2026-10-10T11:59:00Z",
});
let composer: HTMLFormElement;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  composer = document.createElement("form");
  host = document.createElement("div");
  document.body.append(composer, host);
  root = createRoot(composer);
});
afterEach(async () => {
  await act(async () => root.unmount());
  composer.remove();
  host.remove();
  vi.unstubAllGlobals();
});
async function render(overrides: Partial<ComponentProps<typeof ProviderUsageSection>> = {}) {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <ProviderUsageSection
          host={host}
          providers={deriveProviderInstanceEntries([codex, personal, claude])}
          catalogKnown
          selectedModel={selectedModel}
          multipleModels={false}
          context={context}
          contextModelSelection={selectedModel}
          showContext
          throughput={{
            providerInstanceId: selectedModel.instanceId,
            modelSelection: selectedModel,
            tokensPerSecond: 91,
            outputTokens: 910,
            durationMs: 10_000,
          }}
          disconnected={false}
          {...overrides}
        />
      </TooltipProvider>,
    ),
  );
}
function group(id: string) {
  return host.querySelector(`[data-provider-usage-instance="${id}"]`)!;
}
function threadUsage() {
  return host.querySelector("[data-thread-usage]");
}

it("shows every account and model-specific quota bucket independently of model selection", async () => {
  await render();
  expect(group("codex").textContent).toContain("5h12%");
  expect(group("codex-personal").textContent).toContain("5h34%");
  expect(group("claude-work").textContent).toContain("Week · Opus71%Week · Sonnet84%");
  expect(threadUsage()?.textContent).toContain(
    "Claude Work · claude-opus-5-5Context5%Turn average91 tok/s",
  );
  for (const element of host.querySelectorAll("[data-provider-usage-instance]")) {
    expect(element.textContent).not.toMatch(/Context|Turn average/);
  }
  const quotas = [...host.querySelectorAll("[data-provider-usage-instance]")].map(
    (el) => el.textContent,
  );
  await render({ selectedModel: { instanceId: codex.instanceId, model: "gpt-5" } });
  expect(
    [...host.querySelectorAll("[data-provider-usage-instance]")].map((el) => el.textContent),
  ).toEqual(quotas);
  expect(threadUsage()?.textContent).toContain("Codex · gpt-5Context—Turn average— tok/s");
  await render({ selectedModel: { ...selectedModel, model: "claude-sonnet-5-5" } });
  expect(threadUsage()?.textContent).toContain("Context—Turn average— tok/s");
  expect(group("claude-work").textContent).toContain("Week · Opus71%Week · Sonnet84%");
  await render();
  expect(threadUsage()?.textContent).toContain("Context5%Turn average91 tok/s");
  expect(composer.textContent).toBe("");
});

it("keeps duplicate labels and same-driver accounts distinct through updates and removal", async () => {
  const sameName = { ...personal, displayName: "Codex" };
  await render({ providers: deriveProviderInstanceEntries([codex, sameName]) });
  expect(group("codex").textContent).toContain("Codex5h12%");
  // Instance display resolution humanizes a custom id when the server only gives the driver label.
  expect(group("codex-personal").textContent).toContain("Codex Personal5h34%");
  const renamed = { ...codex, displayName: "Shared name" };
  const renamedPersonal = { ...personal, displayName: "Shared name" };
  await render({ providers: deriveProviderInstanceEntries([renamedPersonal, renamed]) });
  expect(group("codex").textContent).toContain("Shared name (codex)5h12%");
  expect(group("codex-personal").textContent).toContain("Shared name (codex-personal)5h34%");
  await render({
    providers: deriveProviderInstanceEntries([{ ...personal, usageLimits: undefined }]),
  });
  expect(host.querySelector('[data-provider-usage-instance="codex"]')).toBeNull();
  expect(group("codex-personal").textContent).toContain("QuotaUnavailable");
  expect(host.textContent).not.toMatch(/12%|34%/);
});

it("retains all providers in multi-model mode but never assigns thread metrics to every account", async () => {
  await render({ multipleModels: true });
  expect(host.querySelectorAll("[data-provider-usage-instance]")).toHaveLength(3);
  expect(threadUsage()).toBeNull();
  expect(group("codex").textContent).toContain("12%");
  await render({ showContext: false });
  expect(threadUsage()?.textContent).not.toContain("Context");
  expect(threadUsage()?.textContent).toContain("Turn average91 tok/s");
});

it("shows disabled and unavailable instances honestly without cached quota or thread values", async () => {
  await render({
    providers: deriveProviderInstanceEntries([
      { ...codex, enabled: false },
      { ...claude, availability: "unavailable" },
    ]),
  });
  expect(group("codex").textContent).toBe("CodexDisabled");
  expect(group("claude-work").textContent).toBe("Claude WorkUnavailable");
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(threadUsage()).toBeNull();
  await render();
  expect(group("codex").textContent).toContain("12%");
});

it("clears every account on disconnect and restores only its current report on reconnect", async () => {
  await render();
  await render({ disconnected: true });
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(host.textContent).not.toMatch(/12%|34%|56%|71%|84%|91 tok/);
  expect(threadUsage()?.textContent).toContain("Context—Turn average— tok/s");
  await render({ providers: deriveProviderInstanceEntries([provider("codex", "Codex", 2)]) });
  expect(group("codex").textContent).toContain("5h2%");
  expect(host.textContent).not.toMatch(/12%|34%|56%/);
});

it("keeps failed refreshes visibly stale and expired buckets unknown", async () => {
  const stale = {
    ...codex,
    usageLimits: { ...codex.usageLimits!, unavailable: { reason: "probeFailed" as const } },
  };
  const expired = {
    ...personal,
    usageLimits: {
      ...personal.usageLimits!,
      windows: personal.usageLimits!.windows.map((window) => ({
        ...window,
        resetsAt: "2026-10-10T12:00:00Z",
      })),
    },
  };
  await render({ providers: deriveProviderInstanceEntries([stale, expired]) });
  expect(group("codex").textContent).toContain("12%Last reported usage · refresh failed");
  expect(group("codex-personal").textContent).toContain("5h—");
  expect(
    group("codex-personal").querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
  ).toBeNull();
});

it("moves outside the composer and survives card closing and switching to a popover", async () => {
  const popover = document.createElement("div");
  document.body.append(popover);
  try {
    await render();
    expect(composer.textContent).toBe("");
    await render({ host: null });
    expect(host.textContent).toBe("");
    await render({ host: popover });
    expect(popover.textContent).toContain("Codex Personal");
    expect(host.textContent).toBe("");
    await render();
    expect(popover.textContent).toBe("");
    expect(group("codex").textContent).toContain("12%");
  } finally {
    popover.remove();
  }
});

it("distinguishes loading, empty, and disconnected catalogs without exposing placeholder ids", async () => {
  await render({ providers: [], catalogKnown: false, selectedModel: NO_PROVIDER_MODEL_SELECTION });
  expect(host.textContent).toContain("Loading providers…");
  await render({ providers: [], selectedModel: NO_PROVIDER_MODEL_SELECTION });
  expect(host.textContent).toBe("Provider usageNo providers configured");
  await render({ providers: [], disconnected: true });
  expect(host.textContent).toContain("Reconnect to see provider usage.");
  expect(host.textContent).not.toContain("t3code_no_provider");
});

it("removes a deleted custom account before stale server snapshots reconcile", async () => {
  const entries = deriveProviderInstanceEntries([codex, personal]);
  await render({
    providers: selectConfiguredUsageProviders(entries, {
      providerInstances: {
        [personal.instanceId]: { driver: personal.driver, enabled: true },
      },
    }),
  });
  expect(group("codex-personal").textContent).toContain("34%");
  await render({ providers: selectConfiguredUsageProviders(entries, { providerInstances: {} }) });
  expect(host.querySelector('[data-provider-usage-instance="codex-personal"]')).toBeNull();
  expect(group("codex").textContent).toContain("12%");
});

it.each(["fork-driver", "acpRegistry", "constructor"])(
  "clears a deleted %s instance even when its id equals its driver",
  async (driver) => {
    const snapshot = provider(driver, "Extra account", 78, {
      driver: ProviderDriverKind.make(driver),
    });
    const entries = deriveProviderInstanceEntries([codex, snapshot]);
    expect(entries[1]?.isDefault).toBe(true);
    await render({
      providers: selectConfiguredUsageProviders(entries, {
        providerInstances: {
          [snapshot.instanceId]: { driver: snapshot.driver, enabled: true },
        },
      }),
    });
    expect(group(driver).textContent).toContain("78%");
    await render({ providers: selectConfiguredUsageProviders(entries, { providerInstances: {} }) });
    expect(host.querySelector(`[data-provider-usage-instance="${driver}"]`)).toBeNull();
    expect(group("codex").textContent).toContain("12%");
  },
);

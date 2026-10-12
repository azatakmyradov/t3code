// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
} from "../../providerInstances";
import { TooltipProvider } from "../ui/tooltip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ProviderUsageSection } from "./ProviderUsageSection";
import { selectConfiguredUsageProviders } from "./providerUsage.logic";
import { useProviderUsagePreferencesStore } from "../../providerUsagePreferencesStore";

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
        resetsAt: "2026-10-10T15:00:00Z",
      },
      { id: "seven_day_opus", kind: "weekly", label: "Weekly · Opus", usedPercent: 71 },
      { id: "seven_day_sonnet", kind: "weekly", label: "Weekly · Sonnet", usedPercent: 84 },
    ],
  },
});
const environmentId = EnvironmentId.make("usage-environment");
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
  useProviderUsagePreferencesStore.setState({ hiddenByEnvironment: {} });
  composer = document.createElement("form");
  host = document.createElement("div");
  document.body.append(composer, host);
  root = createRoot(composer);
});
afterEach(async () => {
  await act(async () => root.unmount());
  composer.remove();
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(overrides: Partial<ComponentProps<typeof ProviderUsageSection>> = {}) {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <ProviderUsageSection
          host={host}
          environmentId={environmentId}
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
function trigger(id: string) {
  return group(id).querySelector<HTMLButtonElement>("button")!;
}
function details() {
  return document.querySelector<HTMLElement>('[data-slot="popover-popup"][data-open]');
}
async function openDetails(id: string) {
  await act(async () => trigger(id).click());
  return details()!;
}
async function pointerClick(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, buttons: 1 }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1 }));
    element.focus();
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.click();
  });
}
async function closeDetails() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}
function threadUsage() {
  return host.querySelector("[data-thread-usage]");
}

it("shows every account and model-specific quota bucket independently of model selection", async () => {
  await render();
  expect(group("codex").textContent).toContain("12%");
  expect(group("codex-personal").textContent).toContain("34%");
  expect(trigger("claude-work").getAttribute("aria-label")).toContain(
    "Weekly · Opus: 71% used. Weekly · Sonnet: 84% used.",
  );
  expect(group("claude-work").textContent).toContain("56%71%+1");
  expect(group("claude-work").textContent).not.toContain("84%");
  expect(threadUsage()?.textContent).toContain("Context5%Turn average91 tok/s");
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
  expect(threadUsage()?.textContent).toContain("Context—Turn average— tok/s");
  await render({ selectedModel: { ...selectedModel, model: "claude-sonnet-5-5" } });
  expect(threadUsage()?.textContent).toContain("Context—Turn average— tok/s");
  expect(trigger("claude-work").getAttribute("aria-label")).toContain(
    "Weekly · Opus: 71% used. Weekly · Sonnet: 84% used.",
  );
  expect(group("claude-work").textContent).toContain("56%71%+1");
  expect(group("claude-work").textContent).not.toContain("84%");
  await render();
  expect(threadUsage()?.textContent).toContain("Context5%Turn average91 tok/s");
  expect(threadUsage()?.querySelector('[role="group"]')?.getAttribute("aria-label")).toContain(
    "Claude Work · claude-opus-5-5. Context window: 5% used",
  );
  expect(composer.textContent).toBe("");
});

it("keeps duplicate labels and same-driver accounts distinct through updates and removal", async () => {
  const sameName = { ...personal, displayName: "Codex" };
  await render({ providers: deriveProviderInstanceEntries([codex, sameName]) });
  expect(trigger("codex").getAttribute("aria-label")).toContain(
    "Codex subscription usage. Session: 12% used.",
  );
  // Instance display resolution humanizes a custom id when the server only gives the driver label.
  expect(trigger("codex-personal").getAttribute("aria-label")).toContain(
    "Codex Personal subscription usage. Session: 34% used.",
  );
  const renamed = { ...codex, displayName: "Shared name" };
  const renamedPersonal = { ...personal, displayName: "Shared name" };
  await render({ providers: deriveProviderInstanceEntries([renamedPersonal, renamed]) });
  expect(trigger("codex").getAttribute("aria-label")).toContain(
    "Shared name (codex) subscription usage. Session: 12% used.",
  );
  expect(trigger("codex-personal").getAttribute("aria-label")).toContain(
    "Shared name (codex-personal) subscription usage. Session: 34% used.",
  );
  await render({
    providers: deriveProviderInstanceEntries([{ ...personal, usageLimits: undefined }]),
  });
  expect(host.querySelector('[data-provider-usage-instance="codex"]')).toBeNull();
  expect(trigger("codex-personal").getAttribute("aria-label")).toContain(
    "Codex Personal: No subscription usage",
  );
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

it("omits disabled providers and shows enabled unavailable instances without cached values", async () => {
  await render({
    providers: deriveProviderInstanceEntries([
      { ...codex, enabled: false },
      { ...claude, availability: "unavailable" },
    ]),
  });
  expect(host.querySelector('[data-provider-usage-instance="codex"]')).toBeNull();
  expect(trigger("claude-work").getAttribute("aria-label")).toContain(
    "Claude Work: This provider is unavailable",
  );
  expect(group("claude-work").textContent).not.toMatch(/56%|71%|84%/);
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(threadUsage()).toBeNull();
  await render();
  expect(group("codex").textContent).toContain("12%");
});

it("explains unavailable summaries and supports keyboard dismissal and reopening", async () => {
  await render({
    providers: deriveProviderInstanceEntries([{ ...codex, usageLimits: undefined }]),
  });
  const row = trigger("codex");
  expect(row.textContent).toBe("—");
  expect(row.getAttribute("aria-label")).toBe(
    "Codex: No subscription usage has been reported for this account.",
  );
  expect(group("codex").querySelector('[role="progressbar"]')).toBeNull();
  await act(async () => {
    row.focus();
    row.click();
  });
  expect(details()?.textContent).toContain(
    "No subscription usage has been reported for this account.",
  );
  await closeDetails();
  expect(details()).toBeNull();
  await openDetails("codex");
  expect(details()?.textContent).toContain(
    "No subscription usage has been reported for this account.",
  );
});

it("keeps every bucket, reset and report time in the compact summary's details", async () => {
  await render();
  const popup = await openDetails("claude-work");
  expect(popup.textContent).toContain("Claude Work");
  expect(popup.textContent).toContain("Subscription quota used");
  expect(popup.textContent).toContain("Weekly · Opus71%");
  expect(popup.textContent).toContain("Weekly · Sonnet84%");
  expect(popup.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
  expect(popup.textContent).toContain("Last reported");
  expect(popup.textContent).toContain(
    `Resets ${new Date("2026-10-10T15:00:00Z").toLocaleString()}`,
  );
  await closeDetails();
  expect(details()).toBeNull();
  expect(composer.textContent).toBe("");
});

it("updates an open account detail on disconnect and removes it when the account is hidden", async () => {
  await render();
  await openDetails("claude-work");
  expect(details()?.textContent).toContain("71%");
  await render({ disconnected: true });
  expect(details()?.textContent).toContain("Reconnect to see this provider's usage limits.");
  expect(details()?.textContent).not.toMatch(/56%|71%|84%/);
  await render();
  expect(details()?.textContent).toContain("71%");
  await act(async () =>
    useProviderUsagePreferencesStore.getState().setHidden(environmentId, claude.instanceId, true),
  );
  expect(details()).toBeNull();
  expect(host.querySelector('[data-provider-usage-instance="claude-work"]')).toBeNull();
});

it("clears every account on disconnect and restores only its current report on reconnect", async () => {
  await render();
  await render({ disconnected: true });
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(host.textContent).not.toMatch(/12%|34%|56%|71%|84%|91 tok/);
  expect(threadUsage()?.textContent).toContain("Context—Turn average— tok/s");
  await render({ providers: deriveProviderInstanceEntries([provider("codex", "Codex", 2)]) });
  expect(group("codex").textContent).toContain("2%");
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
  expect(trigger("codex").getAttribute("aria-label")).toContain(
    "Last reported usage; refresh failed.",
  );
  expect((await openDetails("codex")).textContent).toContain(
    "Last reported usage · refresh failed",
  );
  await closeDetails();
  expect(group("codex-personal").textContent).toContain("—");
  await openDetails("codex-personal");
  expect(
    details()?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
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
    expect(
      popover
        .querySelector('[data-provider-usage-instance="codex-personal"] button')
        ?.getAttribute("aria-label"),
    ).toContain("Codex Personal");
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
  expect(host.textContent).toBe("UsageNo enabled providers");
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

it("hides and restores accounts through the menu without disabling them", async () => {
  await render();
  const trigger = host.parentElement!.querySelector<HTMLButtonElement>(
    '[aria-label="Choose visible providers"]',
  )!;
  await act(async () => trigger.click());
  const choice = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "Claude Work",
    )!;
  expect(choice().getAttribute("aria-checked")).toBe("true");
  await act(async () => choice().click());
  expect(host.querySelector('[data-provider-usage-instance="claude-work"]')).toBeNull();
  expect(threadUsage()).toBeNull();
  expect(claude.enabled).toBe(true);
  expect(choice().getAttribute("aria-checked")).toBe("false");
  await act(async () => choice().click());
  expect(group("claude-work").textContent).toContain("56%");
  expect(threadUsage()?.textContent).toContain("91 tok/s");
});

it("keeps restoration discoverable when all enabled providers are hidden", async () => {
  await render();
  await act(async () => {
    for (const snapshot of [codex, personal, claude]) {
      useProviderUsagePreferencesStore
        .getState()
        .setHidden(environmentId, snapshot.instanceId, true);
    }
  });
  expect(host.textContent).toContain("All providers hidden");
  expect(host.querySelectorAll("[data-provider-usage-instance]")).toHaveLength(0);
  expect(host.querySelector('[aria-label="Choose visible providers"]')).not.toBeNull();
  const showAll = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Show all",
  )!;
  await act(async () => showAll.click());
  expect(host.querySelectorAll("[data-provider-usage-instance]")).toHaveLength(3);
  expect(host.textContent).not.toContain("All providers hidden");
});

it("excludes disabled providers from groups and choices and remembers hidden choices across re-enable", async () => {
  await render({
    providers: deriveProviderInstanceEntries([{ ...codex, enabled: false }, personal]),
  });
  expect(host.querySelector('[data-provider-usage-instance="codex"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Choose visible providers"]')!.click(),
  );
  expect(
    [...document.querySelectorAll('[role="menuitemcheckbox"]')].map((item) => item.textContent),
  ).toEqual(["Codex Personal"]);
  await act(async () => document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!.click());
  await render({ providers: deriveProviderInstanceEntries([{ ...personal, enabled: false }]) });
  expect(host.textContent).toBe("UsageNo enabled providers");
  await render({ providers: deriveProviderInstanceEntries([personal]) });
  expect(host.textContent).toContain("All providers hidden");
  await render({
    environmentId: EnvironmentId.make("other-environment"),
    providers: deriveProviderInstanceEntries([personal]),
  });
  expect(group("codex-personal").textContent).toContain("34%");
});

it("honors settings disable immediately while the previous ready snapshot still reports quota", async () => {
  const snapshots = deriveProviderInstanceEntries([codex]);
  const disabled = {
    providerInstances: { [codex.instanceId]: { driver: codex.driver, enabled: false } },
  };
  await render({
    providers: selectConfiguredUsageProviders(
      applyProviderInstanceSettings(snapshots, disabled),
      disabled,
    ),
  });
  expect(host.textContent).toBe("UsageNo enabled providers");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  const enabled = {
    providerInstances: { [codex.instanceId]: { driver: codex.driver, enabled: true } },
  };
  await render({
    providers: selectConfiguredUsageProviders(
      applyProviderInstanceSettings(snapshots, enabled),
      enabled,
    ),
  });
  expect(group("codex").textContent).toContain("12%");
});

it("keeps the narrow card open through quota details, visibility changes and recovery", async () => {
  const outerContainer = document.createElement("div");
  document.body.append(outerContainer);
  const outerRoot = createRoot(outerContainer);
  let nestedHost: HTMLDivElement | null = null;
  try {
    await act(async () =>
      outerRoot.render(
        <Popover defaultOpen>
          <PopoverTrigger>Thread details</PopoverTrigger>
          <PopoverPopup aria-label="Thread details test">
            <div
              ref={(element) => {
                nestedHost = element;
              }}
            />
          </PopoverPopup>
        </Popover>,
      ),
    );
    await render({ host: nestedHost });
    const quotaTrigger = document.querySelector<HTMLButtonElement>(
      '[data-provider-usage-instance="claude-work"] button',
    )!;
    await act(async () => quotaTrigger.click());
    const outer = () => document.querySelector('[aria-label="Thread details test"][data-open]');
    const inner = () =>
      document.querySelector<HTMLElement>('[aria-label="Claude Work usage details"][data-open]');
    expect(outer()).not.toBeNull();
    expect(inner()?.textContent).toContain("Weekly · Sonnet84%");
    await act(async () => inner()!.click());
    expect(outer()).not.toBeNull();
    await act(async () =>
      inner()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(inner()).toBeNull();
    expect(outer()).not.toBeNull();
    expect(document.activeElement).toBe(quotaTrigger);
    await act(async () => quotaTrigger.click());
    expect(inner()).not.toBeNull();
    await act(async () =>
      inner()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    const visibility = document.querySelector<HTMLButtonElement>(
      '[aria-label="Choose visible providers"]',
    )!;
    await act(async () => visibility.click());
    const choice = document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
    await pointerClick(choice);
    expect(outer()).not.toBeNull();
    expect(document.querySelector('[data-provider-usage-instance="codex"]')).toBeNull();
    for (const item of document.querySelectorAll<HTMLElement>(
      '[role="menuitemcheckbox"][aria-checked="true"]',
    )) {
      await pointerClick(item);
      expect(outer()).not.toBeNull();
    }
    expect(outer()?.textContent).toContain("All providers hidden");
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
    expect(outer()).not.toBeNull();
    expect(document.activeElement).toBe(visibility);
    const showAll = [...outer()!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Show all",
    )!;
    await pointerClick(showAll);
    expect(outer()).not.toBeNull();
    expect(outer()?.querySelectorAll("[data-provider-usage-instance]")).toHaveLength(3);
  } finally {
    await render({ host: null });
    await act(async () => outerRoot.unmount());
    outerContainer.remove();
  }
});

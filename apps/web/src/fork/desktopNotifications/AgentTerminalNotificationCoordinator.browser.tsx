import "../../index.css";

import {
  EnvironmentId,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  TurnId,
  type DesktopAgentNotificationActivatedPayload,
  type DesktopBridge,
  type OrchestrationLatestTurn,
} from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, useSyncExternalStore, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { __resetLocalApiForTests } from "../../localApi";
import { AgentTerminalNotificationCoordinator } from "./AgentTerminalNotificationCoordinator";

const settingsStore = vi.hoisted(() => ({
  value: {
    fork: {
      snippets: [],
      desktopAgentTerminalNotificationsEnabled: true,
    },
  },
  reset() {
    this.value = {
      fork: {
        snippets: [],
        desktopAgentTerminalNotificationsEnabled: true,
      },
    };
  },
}));

const entityStore = vi.hoisted(() => {
  let projects: ReadonlyArray<EnvironmentProject> = [];
  let threads: ReadonlyArray<EnvironmentThreadShell> = [];
  const listeners = new Set<() => void>();
  return {
    set(next: {
      readonly projects: ReadonlyArray<EnvironmentProject>;
      readonly threads: ReadonlyArray<EnvironmentThreadShell>;
    }) {
      projects = next.projects;
      threads = next.threads;
      for (const listener of listeners) listener();
    },
    reset() {
      projects = [];
      threads = [];
      listeners.clear();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getProjects: () => projects,
    getThreads: () => threads,
    setActiveEnvironmentId: vi.fn(),
  };
});

vi.mock("../../state/entities", () => ({
  useProjects: () =>
    useSyncExternalStore(entityStore.subscribe, entityStore.getProjects, entityStore.getProjects),
  useThreadShells: () =>
    useSyncExternalStore(entityStore.subscribe, entityStore.getThreads, entityStore.getThreads),
  setActiveEnvironmentId: entityStore.setActiveEnvironmentId,
}));

vi.mock("../../hooks/useSettings", () => ({
  useClientSettingsHydrated: () => true,
  usePrimarySettings: (selector?: (settings: typeof settingsStore.value) => unknown) =>
    selector ? selector(settingsStore.value) : settingsStore.value,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");
const ISO_REQUESTED = "2026-06-16T12:00:00.000Z";
const ISO_STARTED = "2026-06-16T12:00:01.000Z";
const ISO_COMPLETED = "2026-06-16T12:00:10.000Z";

type Mounted = {
  readonly cleanup: () => Promise<void>;
};

async function render(component: ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | null = createRoot(container);
  await act(async () => {
    root?.render(component);
  });
  return {
    cleanup: async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
}

function turn(input: {
  readonly state: OrchestrationLatestTurn["state"];
  readonly completedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: TurnId.make("turn-1"),
    state: input.state,
    requestedAt: ISO_REQUESTED,
    startedAt: ISO_STARTED,
    completedAt: input.completedAt ?? null,
    assistantMessageId: null,
  };
}

function project(): EnvironmentProject {
  return {
    id: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    title: "T3 Code",
    workspaceRoot: "/repo/t3code",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: ISO_REQUESTED,
    updatedAt: ISO_COMPLETED,
  };
}

function threadSummary(latestTurn: OrchestrationLatestTurn | null): EnvironmentThreadShell {
  return {
    id: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Fix notifications",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    createdAt: ISO_REQUESTED,
    archivedAt: null,
    updatedAt: ISO_COMPLETED,
    latestTurn,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function setThreadState(latestTurn: OrchestrationLatestTurn | null) {
  entityStore.set({ projects: [project()], threads: [threadSummary(latestTurn)] });
}

function installDesktopBridge() {
  const activationListeners: Array<(payload: DesktopAgentNotificationActivatedPayload) => void> =
    [];
  const bridge = {
    getAppBranding: vi.fn().mockReturnValue(null),
    getLocalEnvironmentBootstrap: vi.fn().mockReturnValue({
      label: "Local environment",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
    }),
    getClientSettings: vi.fn().mockResolvedValue(null),
    setClientSettings: vi.fn().mockResolvedValue(undefined),
    showAgentNotification: vi.fn().mockResolvedValue(true),
    onAgentNotificationActivated: vi.fn((listener) => {
      activationListeners.push(listener);
      return () => {
        const index = activationListeners.indexOf(listener);
        if (index >= 0) {
          activationListeners.splice(index, 1);
        }
      };
    }),
  } as unknown as DesktopBridge;
  window.desktopBridge = bridge;
  return {
    bridge,
    activationListeners,
  };
}

function createTestRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    component: () => <AgentTerminalNotificationCoordinator />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const threadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$environmentId/$threadId",
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, threadRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function mountCoordinator(initialPath: string) {
  const router = createTestRouter(initialPath);
  const mounted = await render(<RouterProvider router={router} />);
  return { mounted, router };
}

async function waitForCoordinatorReady(bridge: DesktopBridge) {
  await vi.waitFor(() => {
    expect(bridge.onAgentNotificationActivated).toHaveBeenCalledTimes(1);
  });
}

describe("AgentTerminalNotificationCoordinator", () => {
  let mounted: Mounted | null = null;

  beforeEach(async () => {
    await __resetLocalApiForTests();
    settingsStore.reset();
    entityStore.reset();
    entityStore.setActiveEnvironmentId.mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(async () => {
    await mounted?.cleanup().catch(() => {});
    mounted = null;
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "desktopBridge");
    Reflect.deleteProperty(window, "nativeApi");
    await __resetLocalApiForTests();
    settingsStore.reset();
    entityStore.reset();
  });

  it("suppresses notifications for the focused active thread", async () => {
    const { bridge } = installDesktopBridge();
    setThreadState(turn({ state: "running" }));
    const result = await mountCoordinator(`/${ENVIRONMENT_ID}/${THREAD_ID}`);
    mounted = result.mounted;
    await waitForCoordinatorReady(bridge);

    setThreadState(turn({ state: "completed", completedAt: ISO_COMPLETED }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(bridge.showAgentNotification).not.toHaveBeenCalled();
  });

  it("sends a notification when the app is unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { bridge } = installDesktopBridge();
    setThreadState(turn({ state: "running" }));
    const result = await mountCoordinator(`/${ENVIRONMENT_ID}/${THREAD_ID}`);
    mounted = result.mounted;
    await waitForCoordinatorReady(bridge);

    setThreadState(turn({ state: "completed", completedAt: ISO_COMPLETED }));

    await vi.waitFor(() => expect(bridge.showAgentNotification).toHaveBeenCalledTimes(1));
    expect(bridge.showAgentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fix notifications",
        body: "Agent finished in T3 Code",
        environmentId: ENVIRONMENT_ID,
        threadId: THREAD_ID,
      }),
    );
  });

  it("sends a notification for a different focused thread", async () => {
    const { bridge } = installDesktopBridge();
    setThreadState(turn({ state: "running" }));
    const result = await mountCoordinator(`/${ENVIRONMENT_ID}/${OTHER_THREAD_ID}`);
    mounted = result.mounted;
    await waitForCoordinatorReady(bridge);

    setThreadState(turn({ state: "error", completedAt: ISO_COMPLETED }));

    await vi.waitFor(() => expect(bridge.showAgentNotification).toHaveBeenCalledTimes(1));
    expect(bridge.showAgentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Agent failed in T3 Code",
        environmentId: ENVIRONMENT_ID,
        threadId: THREAD_ID,
      }),
    );
  });

  it("suppresses notifications when the setting is disabled", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    settingsStore.value = {
      fork: { snippets: [], desktopAgentTerminalNotificationsEnabled: false },
    };
    const { bridge } = installDesktopBridge();
    setThreadState(turn({ state: "running" }));
    const result = await mountCoordinator(`/${ENVIRONMENT_ID}/${THREAD_ID}`);
    mounted = result.mounted;
    await waitForCoordinatorReady(bridge);
    setThreadState(turn({ state: "completed", completedAt: ISO_COMPLETED }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(bridge.showAgentNotification).not.toHaveBeenCalled();
  });

  it("navigates to an activated notification thread", async () => {
    const { activationListeners, bridge } = installDesktopBridge();
    const result = await mountCoordinator("/");
    mounted = result.mounted;
    await waitForCoordinatorReady(bridge);

    activationListeners[0]?.({
      environmentId: ENVIRONMENT_ID,
      threadId: THREAD_ID,
    });

    await vi.waitFor(() =>
      expect(result.router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${THREAD_ID}`),
    );
    expect(entityStore.setActiveEnvironmentId).toHaveBeenCalledWith(ENVIRONMENT_ID);
  });
});

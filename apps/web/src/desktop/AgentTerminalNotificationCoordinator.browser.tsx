import "../index.css";

import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TurnId,
  type DesktopAgentNotificationActivatedPayload,
  type DesktopBridge,
  type OrchestrationLatestTurn,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { __resetClientSettingsPersistenceForTests, getClientSettings } from "../hooks/useSettings";
import { __resetLocalApiForTests } from "../localApi";
import { useStore, type EnvironmentState } from "../store";
import type { Project, SidebarThreadSummary } from "../types";
import { AgentTerminalNotificationCoordinator } from "./AgentTerminalNotificationCoordinator";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");
const ISO_REQUESTED = "2026-06-16T12:00:00.000Z";
const ISO_STARTED = "2026-06-16T12:00:01.000Z";
const ISO_COMPLETED = "2026-06-16T12:00:10.000Z";

type Mounted = Awaited<ReturnType<typeof render>> & {
  readonly cleanup?: () => Promise<void>;
  readonly unmount?: () => Promise<void>;
};

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

function project(): Project {
  return {
    id: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    name: "T3 Code",
    cwd: "/repo/t3code",
    defaultModelSelection: null,
    scripts: [],
  };
}

function threadSummary(latestTurn: OrchestrationLatestTurn | null): SidebarThreadSummary {
  return {
    id: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Fix notifications",
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

function environmentState(thread: SidebarThreadSummary): EnvironmentState {
  const currentProject = project();
  return {
    projectIds: [PROJECT_ID],
    projectById: { [PROJECT_ID]: currentProject },
    threadIds: [thread.id],
    threadIdsByProjectId: { [PROJECT_ID]: [thread.id] },
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    sidebarThreadSummaryById: { [thread.id]: thread },
    bootstrapComplete: true,
  };
}

function setThreadState(latestTurn: OrchestrationLatestTurn | null) {
  useStore.setState({
    activeEnvironmentId: ENVIRONMENT_ID,
    environmentStateById: {
      [ENVIRONMENT_ID]: environmentState(threadSummary(latestTurn)),
    },
  });
}

function installDesktopBridge(settings: Partial<ClientSettings> = {}) {
  const activationListeners: Array<(payload: DesktopAgentNotificationActivatedPayload) => void> =
    [];
  const bridge = {
    getAppBranding: vi.fn().mockReturnValue(null),
    getLocalEnvironmentBootstrap: vi.fn().mockReturnValue({
      label: "Local environment",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
    }),
    getClientSettings: vi.fn().mockResolvedValue({
      ...DEFAULT_CLIENT_SETTINGS,
      ...settings,
    }),
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
    expect(bridge.getClientSettings).toHaveBeenCalled();
  });
}

describe("AgentTerminalNotificationCoordinator", () => {
  let mounted: Mounted | null = null;

  beforeEach(async () => {
    await __resetLocalApiForTests();
    __resetClientSettingsPersistenceForTests();
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(async () => {
    const teardown = mounted?.cleanup ?? mounted?.unmount;
    await teardown?.call(mounted).catch(() => {});
    mounted = null;
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "desktopBridge");
    Reflect.deleteProperty(window, "nativeApi");
    await __resetLocalApiForTests();
    __resetClientSettingsPersistenceForTests();
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
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
    const { bridge } = installDesktopBridge({
      desktopAgentTerminalNotificationsEnabled: false,
    });
    setThreadState(turn({ state: "running" }));
    const result = await mountCoordinator(`/${ENVIRONMENT_ID}/${THREAD_ID}`);
    mounted = result.mounted;
    await waitForCoordinatorReady(bridge);
    await vi.waitFor(() =>
      expect(getClientSettings().desktopAgentTerminalNotificationsEnabled).toBe(false),
    );

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
    expect(useStore.getState().activeEnvironmentId).toBe(ENVIRONMENT_ID);
  });
});

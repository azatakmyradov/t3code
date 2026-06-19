import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type DesktopAgentNotificationInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

import { AGENT_NOTIFICATION_ACTIVATED_CHANNEL } from "../fork/channels.ts";

const { NotificationMock, isSupportedMock, notificationInstances } = vi.hoisted(() => {
  type NotificationInstance = {
    options: Electron.NotificationConstructorOptions;
    listeners: Map<string, () => void>;
    show: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  const instances: NotificationInstance[] = [];
  const supported = vi.fn();
  const notification = Object.assign(
    vi.fn(function (this: NotificationInstance, options: Electron.NotificationConstructorOptions) {
      this.options = options;
      this.listeners = new Map();
      this.show = vi.fn();
      this.on = vi.fn((event: string, listener: () => void) => {
        this.listeners.set(event, listener);
        return this;
      });
      instances.push(this);
    }),
    {
      isSupported: supported,
    },
  );

  return {
    NotificationMock: notification,
    isSupportedMock: supported,
    notificationInstances: instances,
  };
});

vi.mock("electron", () => ({
  Notification: NotificationMock,
}));

import * as ElectronNotification from "./ElectronNotification.ts";
import * as ElectronWindow from "./ElectronWindow.ts";

const notificationInput: DesktopAgentNotificationInput = {
  id: "environment-1:thread-1:turn-1",
  title: "Fix notifications",
  body: "Agent finished in T3 Code",
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

function makeWindowService(input?: {
  readonly currentWindow?: Electron.BrowserWindow | undefined;
  readonly reveal?: (window: Electron.BrowserWindow) => void;
  readonly sendAll?: (channel: string, ...args: readonly unknown[]) => void;
}): ElectronWindow.ElectronWindowShape {
  const currentWindow = Option.fromNullishOr(input?.currentWindow);
  return ElectronWindow.ElectronWindow.of({
    create: () => Effect.die("unexpected window create"),
    main: Effect.succeed(currentWindow),
    currentMainOrFirst: Effect.succeed(currentWindow),
    focusedMainOrFirst: Effect.succeed(currentWindow),
    setMain: () => Effect.void,
    clearMain: () => Effect.void,
    reveal: (window) =>
      Effect.sync(() => {
        input?.reveal?.(window);
      }),
    sendAll: (channel, ...args) =>
      Effect.sync(() => {
        input?.sendAll?.(channel, ...args);
      }),
    destroyAll: Effect.void,
    syncAllAppearance: () => Effect.void,
  });
}

function withNotifications<A, E, R>(
  effect: Effect.Effect<A, E, R | ElectronNotification.ElectronNotification>,
  windowService = makeWindowService(),
) {
  const layer = ElectronNotification.layer.pipe(
    Layer.provide(Layer.succeed(ElectronWindow.ElectronWindow, windowService)),
  );
  return effect.pipe(Effect.provide(layer));
}

describe("ElectronNotification", () => {
  beforeEach(() => {
    notificationInstances.length = 0;
    isSupportedMock.mockReset();
    isSupportedMock.mockReturnValue(true);
    NotificationMock.mockClear();
    NotificationMock.mockImplementation(function (
      this: (typeof notificationInstances)[number],
      options: Electron.NotificationConstructorOptions,
    ) {
      this.options = options;
      this.listeners = new Map();
      this.show = vi.fn();
      this.on = vi.fn((event: string, listener: () => void) => {
        this.listeners.set(event, listener);
        return this;
      });
      notificationInstances.push(this);
    });
  });

  it.effect("returns false when native notifications are unsupported", () =>
    withNotifications(
      Effect.gen(function* () {
        isSupportedMock.mockReturnValue(false);
        const notifications = yield* ElectronNotification.ElectronNotification;

        const result = yield* notifications.showAgentNotification(notificationInput);

        assert.isFalse(result);
        assert.equal(NotificationMock.mock.calls.length, 0);
      }),
    ),
  );

  it.effect("shows a supported native notification", () =>
    withNotifications(
      Effect.gen(function* () {
        const notifications = yield* ElectronNotification.ElectronNotification;

        const result = yield* notifications.showAgentNotification(notificationInput);

        assert.isTrue(result);
        assert.equal(NotificationMock.mock.calls.length, 1);
        assert.deepEqual(notificationInstances[0]?.options, {
          title: "Fix notifications",
          body: "Agent finished in T3 Code",
          silent: false,
        });
        assert.equal(notificationInstances[0]?.show.mock.calls.length, 1);
      }),
    ),
  );

  it.effect("reveals a window and sends the activation payload when clicked", () => {
    const currentWindow = { id: 1 } as Electron.BrowserWindow;
    const reveal = vi.fn();
    const sendAll = vi.fn();
    return withNotifications(
      Effect.gen(function* () {
        const notifications = yield* ElectronNotification.ElectronNotification;

        const result = yield* notifications.showAgentNotification(notificationInput);
        notificationInstances[0]?.listeners.get("click")?.();
        yield* Effect.promise(() => Promise.resolve());

        assert.isTrue(result);
        assert.deepEqual(reveal.mock.calls, [[currentWindow]]);
        assert.deepEqual(sendAll.mock.calls, [
          [
            AGENT_NOTIFICATION_ACTIVATED_CHANNEL,
            {
              environmentId: EnvironmentId.make("environment-1"),
              threadId: ThreadId.make("thread-1"),
            },
          ],
        ]);
      }),
      makeWindowService({ currentWindow, reveal, sendAll }),
    );
  });

  it.effect("returns false when constructing the notification fails", () =>
    withNotifications(
      Effect.gen(function* () {
        NotificationMock.mockImplementationOnce(() => {
          throw new Error("constructor failed");
        });
        const notifications = yield* ElectronNotification.ElectronNotification;

        const result = yield* notifications.showAgentNotification(notificationInput);

        assert.isFalse(result);
      }),
    ),
  );
});

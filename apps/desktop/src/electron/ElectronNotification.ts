import type { DesktopAgentNotificationInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

import { AGENT_NOTIFICATION_ACTIVATED_CHANNEL } from "../fork/channels.ts";
import * as ElectronWindow from "./ElectronWindow.ts";

export interface ElectronNotificationShape {
  readonly isSupported: Effect.Effect<boolean>;
  readonly showAgentNotification: (input: DesktopAgentNotificationInput) => Effect.Effect<boolean>;
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  ElectronNotificationShape
>()("@t3tools/desktop/electron/ElectronNotification") {}

const isSupported = Effect.try({
  try: () => Electron.Notification.isSupported(),
  catch: () => false,
}).pipe(Effect.orElseSucceed(() => false));

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;

  return ElectronNotification.of({
    isSupported,
    showAgentNotification: Effect.fn("desktop.electron.notification.showAgentNotification")(
      function* (input) {
        if (!(yield* isSupported)) {
          return false;
        }

        const notification = yield* Effect.try({
          try: () =>
            new Electron.Notification({
              title: input.title,
              ...(input.body === undefined ? {} : { body: input.body }),
              silent: false,
            }),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));
        if (notification === null) {
          return false;
        }

        const context = yield* Effect.context<never>();
        const runPromise = Effect.runPromiseWith(context);
        notification.on("click", () => {
          void runPromise(
            Effect.gen(function* () {
              const window = yield* electronWindow.currentMainOrFirst;
              if (Option.isSome(window)) {
                yield* electronWindow.reveal(window.value);
              }
              yield* electronWindow.sendAll(AGENT_NOTIFICATION_ACTIVATED_CHANNEL, {
                environmentId: input.environmentId,
                threadId: input.threadId,
              });
            }).pipe(Effect.ignoreCause()),
          );
        });

        return yield* Effect.try({
          try: () => {
            notification.show();
            return true;
          },
          catch: () => false,
        }).pipe(Effect.orElseSucceed(() => false));
      },
    ),
  });
});

export const layer = Layer.effect(ElectronNotification, make);

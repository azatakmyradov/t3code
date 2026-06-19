import { DesktopAgentNotificationInputSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ElectronNotification from "../electron/ElectronNotification.ts";
import * as ForkIpcChannels from "./channels.ts";
import { makeIpcMethod } from "../ipc/DesktopIpc.ts";

export const showAgentNotification = makeIpcMethod({
  channel: ForkIpcChannels.SHOW_AGENT_NOTIFICATION_CHANNEL,
  payload: DesktopAgentNotificationInputSchema,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.notifications.showAgentNotification")(function* (input) {
    const notifications = yield* ElectronNotification.ElectronNotification;
    return yield* notifications.showAgentNotification(input);
  }),
});

export const forkIpcMethods = [showAgentNotification] as const;

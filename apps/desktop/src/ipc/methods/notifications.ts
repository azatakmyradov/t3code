import { DesktopAgentNotificationInputSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ElectronNotification from "../../electron/ElectronNotification.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const showAgentNotification = makeIpcMethod({
  channel: IpcChannels.SHOW_AGENT_NOTIFICATION_CHANNEL,
  payload: DesktopAgentNotificationInputSchema,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.notifications.showAgentNotification")(function* (input) {
    const notifications = yield* ElectronNotification.ElectronNotification;
    return yield* notifications.showAgentNotification(input);
  }),
});

import type { DesktopBridge } from "@t3tools/contracts";
import type { IpcRenderer } from "electron";

import * as ForkIpcChannels from "./channels.ts";

export function makeForkDesktopBridge(ipcRenderer: IpcRenderer) {
  return {
    showAgentNotification: (input) =>
      ipcRenderer.invoke(ForkIpcChannels.SHOW_AGENT_NOTIFICATION_CHANNEL, input),
    onAgentNotificationActivated: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        listener(payload as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(ForkIpcChannels.AGENT_NOTIFICATION_ACTIVATED_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(
          ForkIpcChannels.AGENT_NOTIFICATION_ACTIVATED_CHANNEL,
          wrappedListener,
        );
      };
    },
  } satisfies Partial<DesktopBridge>;
}

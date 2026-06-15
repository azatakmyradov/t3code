/**
 * Web Notification API helpers for agent lifecycle notifications.
 *
 * Works in both the browser and the Electron renderer (the renderer exposes the
 * standard `Notification` global). Mobile keeps its existing push system and is
 * untouched here.
 */
import { scopedThreadKey } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { getClientSettings } from "../hooks/useSettings";
import { getAppRouter } from "../router";
import { buildThreadRouteParams } from "../threadRoutes";

export function supportsNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Whether the app window is currently focused and visible. Mirrors the
 * condition used by the toast auto-dismiss logic (`toast.tsx`).
 */
export function isWindowFocused(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Requests notification permission when it has not yet been granted or denied.
 * Returns the resulting permission state.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!supportsNotifications()) {
    return "denied";
  }
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

export interface NotifyAgentEventOptions {
  readonly title: string;
  readonly body: string;
  readonly threadRef: ScopedThreadRef;
}

/**
 * Fires a desktop/browser notification for an agent event, respecting the
 * user's `agentNotificationMode` setting. Reads the settings snapshot at call
 * time so it always reflects the latest value.
 */
export function notifyAgentEvent({ title, body, threadRef }: NotifyAgentEventOptions): void {
  const mode = getClientSettings().agentNotificationMode;
  if (mode === "off") {
    return;
  }
  if (!supportsNotifications() || Notification.permission !== "granted") {
    return;
  }
  if (mode === "when-not-focused" && isWindowFocused()) {
    return;
  }

  const tag = scopedThreadKey(threadRef);
  // `renotify` is a valid Notification option but missing from the lib DOM
  // typings, so widen the options object to include it.
  const notification = new Notification(title, {
    body,
    tag,
    renotify: true,
  } as NotificationOptions & { renotify: boolean });
  notification.addEventListener("click", () => {
    window.focus();
    void getAppRouter()?.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
    notification.close();
  });
}

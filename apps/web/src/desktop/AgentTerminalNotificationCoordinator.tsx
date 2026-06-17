import { scopeThreadRef } from "@t3tools/client-runtime";
import type { DesktopAgentNotificationActivatedPayload } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { useClientSettingsHydrated, useSettings } from "../hooks/useSettings";
import { useStore, type AppState } from "../store";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import {
  collectAgentTerminalNotificationCandidates,
  formatAgentTerminalNotification,
} from "./agentTerminalNotifications.logic";

function isSameThread(
  left: { readonly environmentId: string; readonly threadId: string } | null | undefined,
  right: { readonly environmentId: string; readonly threadId: string },
): boolean {
  return left?.environmentId === right.environmentId && left.threadId === right.threadId;
}

export function AgentTerminalNotificationCoordinator() {
  const navigate = useNavigate();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const clientSettingsHydrated = useClientSettingsHydrated();
  const enabled = useSettings((settings) => settings.desktopAgentTerminalNotificationsEnabled);
  const previousStateRef = useRef<AppState | null>(null);
  const deliveredKeysRef = useRef(new Set<string>());
  const routeThreadRefRef = useRef(routeThreadRef);
  const clientSettingsHydratedRef = useRef(clientSettingsHydrated);
  const enabledRef = useRef(enabled);

  routeThreadRefRef.current = routeThreadRef;
  clientSettingsHydratedRef.current = clientSettingsHydrated;
  enabledRef.current = enabled;

  const handleActivation = useEffectEvent((payload: DesktopAgentNotificationActivatedPayload) => {
    const threadRef = scopeThreadRef(payload.environmentId, payload.threadId);
    useStore.getState().setActiveEnvironmentId(payload.environmentId);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  });

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.onAgentNotificationActivated !== "function") {
      return;
    }

    return bridge.onAgentNotificationActivated(handleActivation);
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.showAgentNotification !== "function") {
      return;
    }

    previousStateRef.current = useStore.getState();
    return useStore.subscribe((nextState) => {
      const previousState = previousStateRef.current;
      previousStateRef.current = nextState;
      const candidates = collectAgentTerminalNotificationCandidates(previousState, nextState);
      if (candidates.length === 0) {
        return;
      }

      for (const candidate of candidates) {
        if (
          !enabledRef.current ||
          !clientSettingsHydratedRef.current ||
          deliveredKeysRef.current.has(candidate.key) ||
          (document.hasFocus() && isSameThread(routeThreadRefRef.current, candidate))
        ) {
          continue;
        }

        deliveredKeysRef.current.add(candidate.key);
        const notification = formatAgentTerminalNotification(candidate);
        void bridge
          .showAgentNotification({
            id: candidate.key,
            title: notification.title,
            body: notification.body,
            environmentId: candidate.environmentId,
            threadId: candidate.threadId,
          })
          .catch(() => undefined);
      }
    });
  }, []);

  return null;
}

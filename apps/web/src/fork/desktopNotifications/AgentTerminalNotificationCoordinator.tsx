import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DesktopAgentNotificationActivatedPayload } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import { useClientSettingsHydrated, useSettings } from "../../hooks/useSettings";
import { setActiveEnvironmentId, useProjects, useThreadShells } from "../../state/entities";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../threadRoutes";
import {
  type AgentTerminalNotificationState,
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
  const enabled = useSettings((settings) => settings.fork.desktopAgentTerminalNotificationsEnabled);
  const projects = useProjects();
  const threads = useThreadShells();
  const notificationState = useMemo<AgentTerminalNotificationState>(
    () => ({ projects, threads }),
    [projects, threads],
  );
  const previousStateRef = useRef<AgentTerminalNotificationState | null>(null);
  const deliveredKeysRef = useRef(new Set<string>());
  const routeThreadRefRef = useRef(routeThreadRef);
  const clientSettingsHydratedRef = useRef(clientSettingsHydrated);
  const enabledRef = useRef(enabled);

  routeThreadRefRef.current = routeThreadRef;
  clientSettingsHydratedRef.current = clientSettingsHydrated;
  enabledRef.current = enabled;

  const handleActivation = useEffectEvent((payload: DesktopAgentNotificationActivatedPayload) => {
    const threadRef = scopeThreadRef(payload.environmentId, payload.threadId);
    setActiveEnvironmentId(payload.environmentId);
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

    const previousState = previousStateRef.current;
    previousStateRef.current = notificationState;
    const candidates = collectAgentTerminalNotificationCandidates(previousState, notificationState);
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
  }, [notificationState]);

  return null;
}

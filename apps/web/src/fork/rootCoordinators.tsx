import { AgentTerminalNotificationCoordinator } from "./desktopNotifications/AgentTerminalNotificationCoordinator";

export function ForkRootCoordinators(props: { authenticated: boolean }) {
  if (!props.authenticated) return null;

  return <AgentTerminalNotificationCoordinator />;
}

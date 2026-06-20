import { AppearanceCoordinator } from "./appearance/AppearanceCoordinator";
import { AgentTerminalNotificationCoordinator } from "./desktopNotifications/AgentTerminalNotificationCoordinator";

export function ForkRootCoordinators(props: { authenticated: boolean }) {
  return (
    <>
      <AppearanceCoordinator />
      {props.authenticated ? <AgentTerminalNotificationCoordinator /> : null}
    </>
  );
}

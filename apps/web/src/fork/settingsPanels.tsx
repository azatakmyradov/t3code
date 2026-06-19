import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { SettingsRow, SettingResetButton } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";

export function ForkGeneralSettingsRows() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);

  if (!hasDesktopBridge) return null;

  return (
    <SettingsRow
      title="Agent completion notifications"
      description="Show desktop notifications when an agent finishes or fails outside the focused thread."
      resetAction={
        settings.fork.desktopAgentTerminalNotificationsEnabled !==
        DEFAULT_UNIFIED_SETTINGS.fork.desktopAgentTerminalNotificationsEnabled ? (
          <SettingResetButton
            label="agent completion notifications"
            onClick={() =>
              updateSettings({
                fork: {
                  ...settings.fork,
                  desktopAgentTerminalNotificationsEnabled:
                    DEFAULT_UNIFIED_SETTINGS.fork.desktopAgentTerminalNotificationsEnabled,
                },
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.fork.desktopAgentTerminalNotificationsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({
              fork: {
                ...settings.fork,
                desktopAgentTerminalNotificationsEnabled: Boolean(checked),
              },
            })
          }
          aria-label="Show agent completion desktop notifications"
        />
      }
    />
  );
}

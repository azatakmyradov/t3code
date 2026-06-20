import { createFileRoute } from "@tanstack/react-router";

import { AppearanceSettings } from "../fork/appearance/AppearanceSettings";

function SettingsAppearanceRoute() {
  return <AppearanceSettings />;
}

export const Route = createFileRoute("/settings/appearance")({
  component: SettingsAppearanceRoute,
});

import { createFileRoute } from "@tanstack/react-router";

import { SnippetsSettingsPanel } from "../components/settings/SnippetsSettings";

function SettingsSnippetsRoute() {
  return <SnippetsSettingsPanel />;
}

export const Route = createFileRoute("/settings/snippets")({
  component: SettingsSnippetsRoute,
});

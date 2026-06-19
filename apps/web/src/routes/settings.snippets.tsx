import { createFileRoute } from "@tanstack/react-router";

import { SnippetsSettingsPanel } from "../fork/snippets/SnippetsSettings";

export const Route = createFileRoute("/settings/snippets")({
  component: SnippetsSettingsPanel,
});

import { createFileRoute } from "@tanstack/react-router";

import { JiraSettingsPanel } from "../fork/jira/JiraSettings";

export const Route = createFileRoute("/settings/jira")({
  component: JiraSettingsPanel,
});

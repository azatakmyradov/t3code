import { createFileRoute, redirect } from "@tanstack/react-router";

import { JiraPage } from "../fork/jira/JiraPage";

export const Route = createFileRoute("/jira")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: JiraPage,
});

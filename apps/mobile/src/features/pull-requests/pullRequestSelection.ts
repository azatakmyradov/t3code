import { ProjectId } from "@t3tools/contracts";
import type { NavigationState } from "@react-navigation/native";
import { pullRequestListKey } from "./pullRequestList";

export function selectedPullRequestKey(state: Pick<NavigationState, "routes" | "index">) {
  for (let index = state.index; index >= 0; index--) {
    const route = state.routes[index];
    if (!route) continue;
    if (route.name === "Home" || route.name.startsWith("Thread")) return null;
    if (!route.name.startsWith("PullRequest")) continue;
    const params = route.params;
    if (
      params &&
      "environmentId" in params &&
      "projectId" in params &&
      "host" in params &&
      "repository" in params &&
      "number" in params &&
      typeof params.environmentId === "string" &&
      typeof params.projectId === "string" &&
      typeof params.host === "string" &&
      typeof params.repository === "string" &&
      typeof params.number === "number"
    ) {
      return `${params.environmentId}:${pullRequestListKey({
        projectId: ProjectId.make(params.projectId),
        host: params.host,
        repository: params.repository,
        number: params.number,
        ...("expectedAccountId" in params && typeof params.expectedAccountId === "string"
          ? { expectedAccountId: params.expectedAccountId }
          : {}),
      })}`;
    }
    if (route.name === "PullRequest") return null;
  }
  return null;
}

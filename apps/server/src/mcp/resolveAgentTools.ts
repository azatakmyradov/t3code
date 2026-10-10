import type { ProjectId, ServerSettings } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import type { McpProviderSessionTools } from "./McpProviderSession.ts";

/**
 * A thread's skill switches after applying the project's overrides.
 */
export function resolveAgentTools(
  settings: ServerSettings,
  projectId: ProjectId | null,
): McpProviderSessionTools {
  const effective = resolveProjectSettings(settings, projectId).settings;
  const disabledSkills = [...new Set(effective.disabledSkills)].toSorted();
  const fingerprint = disabledSkills.length === 0 ? "" : JSON.stringify({ disabledSkills });
  return { disabledSkills, fingerprint };
}

import type { ModelSelection, ProjectId, ServerConfig } from "@t3tools/contracts";
import type { LegacyProjectSettingsFields } from "@t3tools/shared/projectSettings";
import { resolveSelectableModelSelection } from "../../lib/modelOptions";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";

/**
 * Default model for a bot task on another environment. Models route by provider instance id,
 * which that environment may not have, so the bot's model is kept only when it can run there;
 * otherwise the project's default applies. Null until the environment's config has loaded.
 */
export function remoteBotTaskModel(
  config: ServerConfig | null,
  botSelection: ModelSelection,
  project: LegacyProjectSettingsFields & { readonly id: ProjectId },
): ModelSelection | null {
  if (!config) return null;
  return (
    resolveSelectableModelSelection(config, botSelection) ??
    scheduledTaskDefaultModel(config, project)
  );
}

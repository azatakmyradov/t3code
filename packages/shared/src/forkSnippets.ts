import type { ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";

export function applyForkSettingsPatch(
  merged: ServerSettings,
  forkPatch: ServerSettingsPatch["fork"] | undefined,
): ServerSettings["fork"] {
  if (forkPatch === undefined) {
    return merged.fork;
  }
  return {
    ...merged.fork,
    ...(forkPatch.snippets !== undefined ? { snippets: forkPatch.snippets } : {}),
    ...(forkPatch.desktopAgentTerminalNotificationsEnabled !== undefined
      ? {
          desktopAgentTerminalNotificationsEnabled:
            forkPatch.desktopAgentTerminalNotificationsEnabled,
        }
      : {}),
  };
}

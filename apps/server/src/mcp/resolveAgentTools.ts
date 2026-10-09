import type { ProjectId, ResolvedMcpServer, ServerSettings } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import type { McpProviderSessionConfig, McpProviderSessionTools } from "./McpProviderSession.ts";

/**
 * A thread's tools from settings whose secrets are already materialized:
 * the project's overrides applied, disabled servers dropped. The fingerprint
 * covers the full config so a rotated secret also counts as a change; it
 * stays on the server and is only ever compared, never sent or logged.
 */
export function resolveAgentTools(
  settings: ServerSettings,
  projectId: ProjectId | null,
): McpProviderSessionTools {
  const effective = resolveProjectSettings(settings, projectId).settings;
  const servers: ResolvedMcpServer[] = Object.entries(effective.mcpServers)
    .filter(([, server]) => server.enabled)
    .map(([name, server]) => ({ name, transport: server.transport }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const disabledSkills = [...new Set(effective.disabledSkills)].toSorted();
  const fingerprint =
    servers.length === 0 && disabledSkills.length === 0
      ? ""
      : JSON.stringify({ servers, disabledSkills });
  return { servers, disabledSkills, fingerprint };
}

/** Providers receive a session-scoped T3 credential, never an OAuth access/refresh token. */
export function proxyAgentTools(
  tools: McpProviderSessionTools,
  credential: Pick<McpProviderSessionConfig, "endpoint" | "authorizationHeader">,
): McpProviderSessionTools {
  return {
    ...tools,
    servers: tools.servers.map((server) =>
      server.transport.type === "http" && server.transport.authentication === "oauth"
        ? {
            name: server.name,
            transport: {
              type: "http" as const,
              url: new URL(
                `/api/mcp-oauth/proxy/${encodeURIComponent(server.name)}`,
                credential.endpoint,
              ).href,
              headers: [
                { name: "Authorization", value: credential.authorizationHeader, sensitive: true },
              ],
            },
          }
        : server,
    ),
  };
}

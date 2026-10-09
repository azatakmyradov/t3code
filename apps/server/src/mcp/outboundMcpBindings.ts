import type { McpOAuthTarget, McpHttpTransport, ServerSettings } from "@t3tools/contracts";
import type { McpOAuthBinding } from "./OutboundMcpOAuth.ts";

const canonicalBindingUrl = (raw: string): string => {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
};

/** Only a transport's actual owner owns credentials; inherited project switches do not. */
export function savedOAuthTransport(
  settings: ServerSettings,
  target: McpOAuthTarget,
): McpHttpTransport | undefined {
  const entry =
    target.projectId === undefined
      ? settings.mcpServers[target.name]
      : settings.projectSettingsOverrides[target.projectId]?.mcpServers?.[target.name];
  return entry?.transport?.type === "http" && entry.transport.authentication === "oauth"
    ? entry.transport
    : undefined;
}

export function oauthBinding(target: McpOAuthTarget, transport: McpHttpTransport): McpOAuthBinding {
  return {
    owner: target.projectId === undefined ? "environment" : `project:${target.projectId}`,
    name: target.name,
    url: canonicalBindingUrl(transport.url),
  };
}

export function savedOAuthBindings(settings: ServerSettings): ReadonlyArray<McpOAuthBinding> {
  const bindings: McpOAuthBinding[] = [];
  for (const [name, entry] of Object.entries(settings.mcpServers)) {
    if (entry.transport.type === "http" && entry.transport.authentication === "oauth") {
      bindings.push({ owner: "environment", name, url: canonicalBindingUrl(entry.transport.url) });
    }
  }
  for (const [projectId, project] of Object.entries(settings.projectSettingsOverrides)) {
    for (const [name, entry] of Object.entries(project.mcpServers ?? {})) {
      if (entry.transport?.type === "http" && entry.transport.authentication === "oauth") {
        bindings.push({
          owner: `project:${projectId}`,
          name,
          url: canonicalBindingUrl(entry.transport.url),
        });
      }
    }
  }
  return bindings;
}

export const sameOAuthBinding = (left: McpOAuthBinding, right: McpOAuthBinding): boolean =>
  left.owner === right.owner &&
  left.name === right.name &&
  canonicalBindingUrl(left.url) === canonicalBindingUrl(right.url);

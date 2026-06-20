/**
 * Fork-contributed MCP capabilities. Upstream owns `"preview"`; the fork adds
 * its capabilities here so `McpInvocationContext`/`McpSessionRegistry` touch a
 * single additive token each instead of hard-coding `"jira"`.
 */
export const FORK_MCP_CAPABILITIES = ["jira"] as const;
export type ForkMcpCapability = (typeof FORK_MCP_CAPABILITIES)[number];

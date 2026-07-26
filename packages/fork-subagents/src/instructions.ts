export type ProviderAgentContext = "root" | "subagent";

export const T3_MANAGED_SUBAGENT_TOOL_INSTRUCTIONS = `

### T3-managed subagent tools

- \`subagent_models\`: list the available Codex and Claude provider instances, models, and reasoning efforts. Call this before choosing a provider, model, or reasoning effort.
- \`subagent_spawn\`: start one T3-managed child using the selected provider and model.
- \`subagent_check\`: inspect a child's current status and latest output preview without consuming its result.
- \`subagent_wait\`: wait for selected children and consume their completed results.
- \`subagent_list\`: list direct T3-managed children of the current thread.
- \`subagent_cancel\`: cancel selected T3-managed children.
`;

export const CHILD_PROVIDER_INSTRUCTIONS = `

## T3-managed subagent

Complete the delegated task independently and return a concise result. Report blockers in the final response instead of requesting parent or user interaction. Do not orchestrate, spawn, or delegate to other agents, and do not ask the user for input.
`;

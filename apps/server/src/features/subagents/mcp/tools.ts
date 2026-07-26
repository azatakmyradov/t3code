import {
  SubagentCancelResult,
  SubagentCheckResult,
  SubagentCheckRequest,
  SubagentIdsRequest,
  SubagentListResult,
  SubagentOutputSection,
  SubagentSpawnResult,
  SubagentSpawnMcpRequest,
} from "@t3tools/fork-subagents/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { McpInvocationContext } from "../../../mcp/McpInvocationContext.ts";
import { SubagentCoordinator, SubagentCoordinatorError } from "../CoordinatorService.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { SubagentModelCatalog } from "./modelCatalog.ts";

const dependencies = [McpInvocationContext, SubagentCoordinator];
const modelDependencies = [McpInvocationContext, ProviderRegistry];

export const SubagentSpawnTool = Tool.make("subagent_spawn", {
  description:
    "Spawn one persistent T3-managed child thread. Use only when the user explicitly requested delegation or parallel agent work. Returns immediately after reserving and starting the child.",
  parameters: SubagentSpawnMcpRequest,
  success: SubagentSpawnResult,
  failure: SubagentCoordinatorError,
  dependencies,
}).annotate(Tool.Title, "Spawn subagent");

export const SubagentModelsTool = Tool.make("subagent_models", {
  description:
    "List the live Codex and Claude provider instances and model values accepted by subagent_spawn, including supported reasoning_effort values. Use this before overriding agent, provider_instance_id, model, or reasoning_effort.",
  parameters: Tool.EmptyParams,
  success: SubagentModelCatalog,
  failure: SubagentCoordinatorError,
  dependencies: modelDependencies,
})
  .annotate(Tool.Title, "List subagent models")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

export const SubagentWaitTool = Tool.make("subagent_wait", {
  description:
    "Wait for all selected T3-managed children to settle and consume their complete pending results. Waiting does not stop children when the MCP request is cancelled.",
  parameters: SubagentIdsRequest,
  success: Schema.Array(SubagentOutputSection),
  failure: SubagentCoordinatorError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for subagents")
  .annotate(Tool.Readonly, true);

export const SubagentCancelTool = Tool.make("subagent_cancel", {
  description:
    "Validate and cancel selected T3-managed children. Already-settled results are consumed without interrupting the child.",
  parameters: SubagentIdsRequest,
  success: Schema.Array(SubagentCancelResult),
  failure: SubagentCoordinatorError,
  dependencies,
}).annotate(Tool.Title, "Cancel subagents");

export const SubagentCheckTool = Tool.make("subagent_check", {
  description:
    "Inspect one child status and a bounded preview of its latest assistant output without consuming its result.",
  parameters: SubagentCheckRequest,
  success: SubagentCheckResult,
  failure: SubagentCoordinatorError,
  dependencies,
})
  .annotate(Tool.Title, "Check subagent")
  .annotate(Tool.Readonly, true);

export const SubagentListTool = Tool.make("subagent_list", {
  description:
    "List the newest direct T3-managed children of the current parent thread. Native provider subagents are intentionally excluded.",
  parameters: Tool.EmptyParams,
  success: Schema.Array(SubagentListResult),
  failure: SubagentCoordinatorError,
  dependencies,
})
  .annotate(Tool.Title, "List subagents")
  .annotate(Tool.Readonly, true);

export const SubagentToolkit = Toolkit.make(
  SubagentSpawnTool,
  SubagentModelsTool,
  SubagentWaitTool,
  SubagentCancelTool,
  SubagentCheckTool,
  SubagentListTool,
);

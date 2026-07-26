import * as Effect from "effect/Effect";

import { requireMcpCapability } from "../../../mcp/McpInvocationContext.ts";
import { SubagentCoordinator, SubagentCoordinatorError } from "../CoordinatorService.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { makeSubagentModelCatalog } from "./modelCatalog.ts";
import { SubagentToolkit } from "./tools.ts";

const authorize = Effect.fn("SubagentToolkit.authorize")(function* () {
  const invocation = yield* requireMcpCapability("subagents").pipe(
    Effect.mapError(
      () =>
        new SubagentCoordinatorError({
          operation: "authorize",
          detail: "Subagent tools are unavailable in this MCP session.",
        }),
    ),
  );
  if (invocation.agentContext !== "root") {
    return yield* new SubagentCoordinatorError({
      operation: "authorize",
      detail: "Subagent tools are unavailable to child sessions.",
    });
  }
  return invocation;
});

export const SubagentToolkitHandlersLive = SubagentToolkit.toLayer({
  subagent_spawn: (input) =>
    Effect.gen(function* () {
      const invocation = yield* authorize();
      const coordinator = yield* SubagentCoordinator;
      return yield* coordinator.spawn(invocation.threadId, {
        prompt: input.prompt,
        title: input.title,
        ...(input.working_dir !== undefined ? { workingDir: input.working_dir } : {}),
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...(input.provider_instance_id !== undefined
          ? { providerInstanceId: input.provider_instance_id }
          : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.reasoning_effort !== undefined
          ? { reasoningEffort: input.reasoning_effort }
          : {}),
      });
    }),
  subagent_models: () =>
    Effect.gen(function* () {
      yield* authorize();
      const providers = yield* ProviderRegistry;
      return makeSubagentModelCatalog(yield* providers.getProviders);
    }),
  subagent_wait: (input) =>
    Effect.gen(function* () {
      const invocation = yield* authorize();
      const coordinator = yield* SubagentCoordinator;
      return yield* coordinator.wait(invocation.threadId, input.ids);
    }),
  subagent_cancel: (input) =>
    Effect.gen(function* () {
      const invocation = yield* authorize();
      const coordinator = yield* SubagentCoordinator;
      return yield* coordinator.cancel(invocation.threadId, input.ids);
    }),
  subagent_check: (input) =>
    Effect.gen(function* () {
      const invocation = yield* authorize();
      const coordinator = yield* SubagentCoordinator;
      return yield* coordinator.check(invocation.threadId, input.id);
    }),
  subagent_list: () =>
    Effect.gen(function* () {
      const invocation = yield* authorize();
      const coordinator = yield* SubagentCoordinator;
      return yield* coordinator.list(invocation.threadId);
    }),
});

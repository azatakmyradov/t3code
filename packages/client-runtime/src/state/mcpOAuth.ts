import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

/** Shared, destination-authorized commands for web, desktop and mobile. */
export function createMcpOAuthEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcCommand(runtime, {
      label: "mcp-oauth:status",
      tag: WS_METHODS.mcpOAuthStatus,
    }),
    begin: createEnvironmentRpcCommand(runtime, {
      label: "mcp-oauth:begin",
      tag: WS_METHODS.mcpOAuthBegin,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.projectId ?? null, input.name]),
      },
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "mcp-oauth:cancel",
      tag: WS_METHODS.mcpOAuthCancel,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "mcp-oauth:disconnect",
      tag: WS_METHODS.mcpOAuthDisconnect,
    }),
  };
}

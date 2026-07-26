import { ORCHESTRATION_WS_METHODS, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily, environmentRpcKey } from "./runtime.ts";

const NATIVE_ACTIVITY_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);

export function isNativeSubagentActivity(activity: OrchestrationThreadActivity): boolean {
  if (!NATIVE_ACTIVITY_KINDS.has(activity.kind)) return false;
  if (typeof activity.payload !== "object" || activity.payload === null) return false;
  return (
    (activity.payload as { readonly itemType?: unknown }).itemType === "collab_agent_tool_call"
  );
}

export function hasNativeSubagentActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): boolean {
  return activities.some(isNativeSubagentActivity);
}

export const nativeSubagentListQueryKey = environmentRpcKey<{
  readonly threadId: string;
}>;

export const nativeSubagentReadQueryKey = environmentRpcKey<{
  readonly threadId: string;
  readonly nativeSubagentId: string;
}>;

export function createNativeSubagentEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:native-subagents:list",
      tag: ORCHESTRATION_WS_METHODS.listNativeSubagents,
      staleTimeMs: 750,
      idleTtlMs: 5_000,
    }),
    read: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:native-subagents:read",
      tag: ORCHESTRATION_WS_METHODS.readNativeSubagent,
      staleTimeMs: 750,
      idleTtlMs: 5_000,
    }),
  };
}

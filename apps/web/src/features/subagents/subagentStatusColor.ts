import type { SubagentStatus } from "@t3tools/fork-subagents/contracts";

export function subagentStatusColor(status: SubagentStatus): string {
  if (status === "running") return "bg-orange-500";
  if (status === "error") return "bg-red-500";
  return "bg-emerald-500";
}

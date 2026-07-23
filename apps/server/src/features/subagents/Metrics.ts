import * as Metric from "effect/Metric";

export const subagentSpawnsTotal = Metric.counter("t3_subagent_spawns_total", {
  description: "Total T3-managed subagent spawn operations.",
});
export const subagentActiveChildren = Metric.gauge("t3_subagent_active_children", {
  description: "Current number of running T3-managed subagents.",
});
export const subagentCompletionsTotal = Metric.counter("t3_subagent_completions_total", {
  description: "Total settled T3-managed subagent runs.",
});
export const subagentWaitsTotal = Metric.counter("t3_subagent_waits_total", {
  description: "Total T3-managed subagent wait operations.",
});
export const subagentCancelsTotal = Metric.counter("t3_subagent_cancels_total", {
  description: "Total T3-managed subagent cancellation operations.",
});
export const subagentDeliveriesTotal = Metric.counter("t3_subagent_deliveries_total", {
  description: "Total T3-managed subagent deferred-delivery attempts.",
});
export const subagentStaleReconciliationsTotal = Metric.counter(
  "t3_subagent_stale_reconciliations_total",
  { description: "Total stale T3-managed subagent runs reconciled at startup." },
);

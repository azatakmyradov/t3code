import type { ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  SUBAGENT_REASONING_EFFORTS,
  SubagentReasoningEffort,
  type SubagentReasoningEffort as SubagentReasoningEffortType,
} from "@t3tools/fork-subagents/contracts";

const supportedReasoningEfforts = new Set<string>(SUBAGENT_REASONING_EFFORTS);

export const SubagentModelCatalog = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      agent: Schema.Literals(["codex", "claude"]),
      provider_instance_id: Schema.String,
      provider_name: Schema.String,
      models: Schema.Array(
        Schema.Struct({
          model: Schema.String,
          name: Schema.String,
          is_default: Schema.Boolean,
          reasoning_efforts: Schema.Array(SubagentReasoningEffort),
          default_reasoning_effort: Schema.optional(SubagentReasoningEffort),
        }),
      ),
    }),
  ),
});
export type SubagentModelCatalog = typeof SubagentModelCatalog.Type;

const isSupportedReasoningEffort = (value: string): value is SubagentReasoningEffortType =>
  supportedReasoningEfforts.has(value);

export const makeSubagentModelCatalog = (
  providers: ReadonlyArray<ServerProvider>,
): SubagentModelCatalog => ({
  providers: providers.flatMap((provider) => {
    if (
      (provider.driver !== "codex" && provider.driver !== "claudeAgent") ||
      !provider.enabled ||
      !provider.installed ||
      provider.availability === "unavailable" ||
      provider.models.length === 0
    ) {
      return [];
    }

    const agent = provider.driver === "codex" ? ("codex" as const) : ("claude" as const);
    const effortOptionId = provider.driver === "codex" ? "reasoningEffort" : "effort";
    const defaultModel = provider.models.find((model) => model.isDefault) ?? provider.models[0];

    return [
      {
        agent,
        provider_instance_id: provider.instanceId,
        provider_name: provider.displayName ?? (agent === "codex" ? "Codex" : "Claude"),
        models: provider.models.map((model) => {
          const effortDescriptor = model.capabilities?.optionDescriptors?.find(
            (descriptor) => descriptor.type === "select" && descriptor.id === effortOptionId,
          );
          const reasoningEfforts =
            effortDescriptor?.type === "select"
              ? effortDescriptor.options
                  .map((option) => option.id)
                  .filter(isSupportedReasoningEffort)
              : [];
          const defaultReasoningEffort =
            effortDescriptor?.type === "select"
              ? [
                  effortDescriptor.currentValue,
                  effortDescriptor.options.find((option) => option.isDefault)?.id,
                ].find(
                  (effort): effort is SubagentReasoningEffortType =>
                    effort !== undefined && isSupportedReasoningEffort(effort),
                )
              : undefined;

          return {
            model: model.slug,
            name: model.name,
            is_default: model.slug === defaultModel?.slug,
            reasoning_efforts: reasoningEfforts,
            ...(defaultReasoningEffort !== undefined
              ? { default_reasoning_effort: defaultReasoningEffort }
              : {}),
          };
        }),
      },
    ];
  }),
});

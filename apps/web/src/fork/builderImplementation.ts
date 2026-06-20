import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection, resolveSelectableModel } from "@t3tools/shared/model";

import { getComposerProviderState } from "../components/chat/composerProviderState";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { applyProviderInstanceSettings, deriveProviderInstanceEntries } from "../providerInstances";

export const BUILDER_MODEL_UNAVAILABLE_MESSAGE =
  "Selected builder provider or model is unavailable. Choose another model.";

export function resolveForkBuilderModelSelection(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const selection = settings.fork.builderModelSelection;
  if (selection === null) {
    return null;
  }

  const entries = applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings);
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!entry || !entry.enabled || !entry.isAvailable) {
    return null;
  }

  const modelOptions = getAppModelOptionsForInstance(settings, entry);
  const model = resolveSelectableModel(entry.driverKind, selection.model, modelOptions);
  if (!model) {
    return null;
  }

  const { modelOptionsForDispatch } = getComposerProviderState({
    provider: entry.driverKind,
    model,
    models: entry.models,
    prompt: "",
    modelOptions: selection.options,
  });

  return createModelSelection(entry.instanceId, model, modelOptionsForDispatch);
}

export function getForkBuilderModelSelectionStatus(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): string | null {
  if (settings.fork.builderModelSelection === null) {
    return null;
  }
  return resolveForkBuilderModelSelection(settings, providers) === null
    ? BUILDER_MODEL_UNAVAILABLE_MESSAGE
    : null;
}

import { ServerSettings, type ServerSettingsPatch } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection } from "./model.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
}

type ModelSelectionPatch =
  | ServerSettingsPatch["textGenerationModelSelection"]
  | ServerSettingsPatch["builderModelSelection"];

export type ModelSelectionSettingsKey = "textGenerationModelSelection" | "builderModelSelection";

export const MODEL_SELECTION_SETTINGS_KEYS: ReadonlyArray<ModelSelectionSettingsKey> = [
  "textGenerationModelSelection",
  "builderModelSelection",
];

function shouldReplaceModelSelection(patch: ModelSelectionPatch | undefined): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const { automaticGitFetchInterval, snippets, ...patchForMergeWithModelSelections } = patch;
  const patchForMerge = { ...patchForMergeWithModelSelections };
  for (const key of MODEL_SELECTION_SETTINGS_KEYS) {
    delete patchForMerge[key];
  }
  const next = deepMerge(current, patchForMerge);
  let nextWithReplacements: ServerSettings = {
    ...next,
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
    ...(snippets !== undefined ? { snippets } : {}),
  };

  for (const key of MODEL_SELECTION_SETTINGS_KEYS) {
    const selectionPatch = patch[key];
    if (!selectionPatch) {
      continue;
    }

    const currentSelection = current[key];
    const instanceId = selectionPatch.instanceId ?? currentSelection.instanceId;
    const model = selectionPatch.model ?? currentSelection.model;
    const options = shouldReplaceModelSelection(selectionPatch)
      ? selectionPatch.options
      : mergeModelSelectionOptionsById({
          current: currentSelection.options,
          patch: selectionPatch.options,
        });

    Object.assign(nextWithReplacements, {
      [key]: createModelSelection(instanceId, model, options),
    });
  }

  return nextWithReplacements;
}

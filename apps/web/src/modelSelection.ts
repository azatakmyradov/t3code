import {
  DEFAULT_BUILDER_MODEL,
  DEFAULT_BUILDER_MODEL_BY_PROVIDER,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  createModelSelection,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { getComposerProviderState } from "./components/chat/composerProviderState";
import { UnifiedSettings } from "@t3tools/contracts/settings";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./providerModels";
import { ModelEsque } from "./components/chat/providerIconUtils";
import { type ProviderInstanceEntry, deriveProviderInstanceEntries } from "./providerInstances";
import { sortModelsForProviderInstance } from "./modelOrdering";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
const DEFAULT_TEXT_GENERATION_INSTANCE_ID = ProviderInstanceId.make("codex");
const DEFAULT_BUILDER_INSTANCE_ID = ProviderInstanceId.make("codex");

/**
 * Resolve the custom-model list for a given instance, preferring the
 * instance's own `providerInstances[id].config.customModels` blob when
 * present and falling back to the legacy per-kind
 * `settings.providers[kind].customModels` bucket for default instances only.
 *
 * The Settings UI promotes the legacy bucket into an explicit
 * `providerInstances[defaultId]` entry on every edit (the "migrate on
 * first write" scheme documented in
 * `ProviderInstanceRegistryHydration`), so this helper exists primarily
 * so readers pick up that promotion immediately — and so first-time
 * viewers on pre-migration settings still see their legacy list on
 * default slots. Custom instances intentionally do not read the legacy
 * per-driver bucket; otherwise one custom model added to `claude_openrouter`
 * can appear on the stock `claudeAgent` instance.
 */
function readInstanceCustomModels(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
): ReadonlyArray<string> {
  const instance = settings.providerInstances?.[instanceId];
  const config = instance?.config;
  if (config !== null && typeof config === "object") {
    const value = (config as Record<string, unknown>).customModels;
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  const defaultInstanceId = defaultInstanceIdForDriver(driverKind);
  if (instanceId !== defaultInstanceId) {
    return [];
  }
  const legacyProviders = settings.providers as Record<
    string,
    { readonly customModels: ReadonlyArray<string> } | undefined
  >;
  return legacyProviders[driverKind]?.customModels ?? [];
}

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isCustom: boolean;
}

function toAppModelOption(model: ServerProvider["models"][number]): AppModelOption {
  const option: AppModelOption = {
    slug: model.slug,
    name: model.name,
    isCustom: model.isCustom,
  };
  if (model.shortName) option.shortName = model.shortName;
  if (model.subProvider) option.subProvider = model.subProvider;
  return option;
}

function readInstanceModelPreferences(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
): { readonly hiddenModels: ReadonlyArray<string>; readonly modelOrder: ReadonlyArray<string> } {
  return (
    settings.providerModelPreferences?.[instanceId] ?? {
      hiddenModels: [],
      modelOrder: [],
    }
  );
}

function applyInstanceModelPreferences(
  options: ReadonlyArray<AppModelOption>,
  preferences: {
    readonly hiddenModels: ReadonlyArray<string>;
    readonly modelOrder: ReadonlyArray<string>;
  },
): AppModelOption[] {
  const hiddenModels = new Set(preferences.hiddenModels);
  return sortModelsForProviderInstance(
    options.filter((option) => option.isCustom || !hiddenModels.has(option.slug)),
    { modelOrder: preferences.modelOrder },
  );
}

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: ProviderDriverKind = ProviderDriverKind.make("codex"),
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
  _selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(toAppModelOption);
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    Arr.filterMap(getProviderModels(providers, provider), (model) =>
      model.isCustom ? Result.failVoid : Result.succeed(model.slug),
    ),
  );

  // Read from the default instance's config first (that's where edits
  // now land), falling back to the legacy per-kind bucket so unmigrated
  // settings and the initial render before the first write both still
  // see the user's authored custom models.
  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  const customModels = readInstanceCustomModels(settings, defaultInstanceId, provider);
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  return applyInstanceModelPreferences(
    options,
    readInstanceModelPreferences(settings, defaultInstanceId),
  );
}

/**
 * Instance-scoped variant of {@link getAppModelOptions}. Built-in models
 * come from the instance's own `entry.models` snapshot (rather than the
 * first-matching-kind fallback in `getProviderModels`), so each custom
 * instance gets the precise model list its driver reported. Custom model
 * slugs come from the instance's own `providerInstances[id].config.customModels`
 * when present, falling back to the legacy per-kind
 * `settings.providers[driverKind].customModels` bucket for default
 * instances only. This keeps two instances of the same kind from leaking
 * custom slugs into each other.
 */
export function getAppModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
): AppModelOption[] {
  const options: AppModelOption[] = entry.models.map(toAppModelOption);
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    Arr.filterMap(entry.models, (model) =>
      model.isCustom ? Result.failVoid : Result.succeed(model.slug),
    ),
  );

  const customModels = readInstanceCustomModels(settings, entry.instanceId, entry.driverKind);
  const normalizer = entry.driverKind;
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, normalizer)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({ slug, name: slug, isCustom: true });
  }

  return applyInstanceModelPreferences(
    options,
    readInstanceModelPreferences(settings, entry.instanceId),
  );
}

export function resolveAppModelSelection(
  provider: ProviderDriverKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

export function resolveAppModelSelectionForInstance(
  instanceId: ProviderInstanceId,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string | null {
  const entry = deriveProviderInstanceEntries(providers).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!entry) return null;
  const options = getAppModelOptionsForInstance(settings, entry);
  return (
    resolveSelectableModel(entry.driverKind, selectedModel, options) ??
    options[0]?.slug ??
    entry.models[0]?.slug ??
    null
  );
}

/**
 * Instance-keyed model options map. Each configured instance gets its own
 * option list so the model picker can show the same driver's built-in and
 * custom instances side by side without collapsing them.
 */
export function getCustomModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  _selectedInstanceId?: ProviderInstanceId | null,
  _selectedModel?: string | null,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of deriveProviderInstanceEntries(providers)) {
    out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
  }
  return out;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  return resolveSettingsModelSelectionState({
    settings,
    providers,
    selection: settings.textGenerationModelSelection,
    defaultSelection: {
      instanceId: DEFAULT_TEXT_GENERATION_INSTANCE_ID,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
    },
    defaultModelByProvider: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
    defaultModel: DEFAULT_GIT_TEXT_GENERATION_MODEL,
  });
}

export function resolveAppBuilderModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  return resolveSettingsModelSelectionState({
    settings,
    providers,
    selection: settings.builderModelSelection,
    defaultSelection: {
      instanceId: DEFAULT_BUILDER_INSTANCE_ID,
      model: DEFAULT_BUILDER_MODEL,
    },
    defaultModelByProvider: DEFAULT_BUILDER_MODEL_BY_PROVIDER,
    defaultModel: DEFAULT_BUILDER_MODEL,
  });
}

interface SettingsModelSelectionResolverInput {
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selection: ModelSelection | null | undefined;
  readonly defaultSelection: ModelSelection;
  readonly defaultModelByProvider: Partial<Record<ProviderDriverKind, string>>;
  readonly defaultModel: string;
}

export interface AppModelSelectionDispatchContext {
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedModel: string;
  readonly selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  readonly selectedPromptEffort: string | null;
  readonly selectedModelSelection: ModelSelection;
}

function resolveSettingsModelSelectionState(
  input: SettingsModelSelectionResolverInput,
): ModelSelection {
  return resolveAppModelSelectionDispatchContext(
    input.settings,
    input.providers,
    input.selection ?? input.defaultSelection,
    {
      defaultModelByProvider: input.defaultModelByProvider,
      defaultModel: input.defaultModel,
    },
  ).selectedModelSelection;
}

export function resolveAppModelSelectionDispatchContext(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
  defaults: {
    readonly defaultModelByProvider?: Partial<Record<ProviderDriverKind, string>>;
    readonly defaultModel?: string;
  } = {},
): AppModelSelectionDispatchContext {
  const entries = deriveProviderInstanceEntries(providers);
  const selectedEntry = entries.find(
    (entry) => entry.instanceId === selection.instanceId && entry.enabled && entry.isAvailable,
  );
  const entry =
    selectedEntry ?? entries.find((candidate) => candidate.enabled && candidate.isAvailable);
  if (entry) {
    // When the instance changed due to fallback (e.g. selected instance was disabled),
    // don't carry over the old instance's model — use the fallback instance's default.
    const selectedModel = selectedEntry ? selection.model : null;
    const model =
      resolveAppModelSelectionForInstance(entry.instanceId, settings, providers, selectedModel) ??
      entry.models[0]?.slug ??
      defaults.defaultModelByProvider?.[entry.driverKind] ??
      defaults.defaultModel;
    if (!model) {
      return {
        selectedProvider: entry.driverKind,
        selectedModel: "",
        selectedProviderModels: entry.models,
        selectedPromptEffort: null,
        selectedModelSelection: createModelSelection(entry.instanceId, "", []),
      };
    }
    const provider = entry.driverKind;
    const composerProviderState = getComposerProviderState({
      provider,
      model,
      models: entry.models,
      prompt: "",
      modelOptions: selectedEntry ? selection.options : undefined,
    });
    const selectedModelSelection = createModelSelection(
      entry.instanceId,
      model,
      composerProviderState.modelOptionsForDispatch,
    );

    return {
      selectedProvider: provider,
      selectedModel: model,
      selectedProviderModels: entry.models,
      selectedPromptEffort: composerProviderState.promptEffort,
      selectedModelSelection,
    };
  }

  const provider = resolveSelectableProvider(providers, selection.instanceId);
  const keptSelectedProvider = providers.some(
    (candidate) =>
      candidate.instanceId === selection.instanceId &&
      candidate.enabled &&
      candidate.availability !== "unavailable",
  );

  // When the provider changed due to fallback (e.g. selected provider was disabled),
  // don't carry over the old provider's model — use the fallback provider's default.
  const selectedModel = keptSelectedProvider ? selection.model : null;
  const model =
    providers.length > 0
      ? resolveAppModelSelection(provider, settings, providers, selectedModel)
      : (defaults.defaultModelByProvider?.[provider] ?? defaults.defaultModel ?? "");
  const selectedProviderModels = getProviderModels(providers, provider);
  const composerProviderState = getComposerProviderState({
    provider,
    model,
    models: selectedProviderModels,
    prompt: "",
    modelOptions: keptSelectedProvider ? selection.options : undefined,
  });
  const selectedModelSelection = createModelSelection(
    defaultInstanceIdForDriver(provider),
    model,
    composerProviderState.modelOptionsForDispatch,
  );

  return {
    selectedProvider: provider,
    selectedModel: model,
    selectedProviderModels,
    selectedPromptEffort: composerProviderState.promptEffort,
    selectedModelSelection,
  };
}

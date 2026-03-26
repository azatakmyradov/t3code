import {
  MODEL_OPTIONS_BY_PROVIDER,
  type ProviderKind,
  type ProviderStartOptions,
  type ServerListProviderModelsResult,
} from "@t3tools/contracts";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { Effect, Layer, Ref } from "effect";

import type { ProviderServiceError } from "../Errors.ts";
import {
  ProviderModelCatalog,
  type ProviderModelCatalogShape,
} from "../Services/ProviderModelCatalog.ts";

const PI_DISCOVERY_TTL_MS = 30_000;

type CacheValue = {
  readonly expiresAt: number;
  readonly result: ServerListProviderModelsResult;
};

function defaultCapabilities() {
  return {
    reasoningEffortLevels: [
      { value: "xhigh", label: "Extra High" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium", isDefault: true as const },
      { value: "low", label: "Low" },
      { value: "minimal", label: "Minimal" },
      { value: "off", label: "Off" },
    ],
    supportsFastMode: false,
    supportsThinkingToggle: false,
    promptInjectedEffortLevels: [],
  };
}

function fallbackModels(provider: ProviderKind): ServerListProviderModelsResult {
  if (provider === "pi") {
    return {
      provider,
      models: [
        {
          slug: "auto",
          name: "Auto (Pi default)",
          capabilities: defaultCapabilities(),
          isDiscovered: false,
        },
      ],
    };
  }

  return {
    provider,
    models: MODEL_OPTIONS_BY_PROVIDER[provider].map((option) => ({
      slug: option.slug,
      name: option.name,
      capabilities: option.capabilities,
      isDiscovered: false,
    })),
  };
}

function piCacheKey(providerOptions?: ProviderStartOptions): string {
  const pi = providerOptions?.pi;
  return JSON.stringify({
    binaryPath: pi?.binaryPath ?? null,
    agentDir: pi?.agentDir ?? null,
  });
}

const makeProviderModelCatalog = Effect.gen(function* () {
  const cacheRef = yield* Ref.make(new Map<string, CacheValue>());

  const listPiModels = (providerOptions?: ProviderStartOptions) =>
    Effect.gen(function* () {
      const key = piCacheKey(providerOptions);
      const now = Date.now();
      const cache = yield* Ref.get(cacheRef);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) {
        return cached.result;
      }

      const result = yield* Effect.sync(() => {
        try {
          const authStorage = AuthStorage.create(providerOptions?.pi?.agentDir);
          const modelRegistry = new ModelRegistry(
            authStorage,
            providerOptions?.pi?.agentDir
              ? `${providerOptions.pi.agentDir.replace(/\/+$/, "")}/models.json`
              : undefined,
          );
          const available = modelRegistry.getAvailable();
          const models = available
            .map((model) => ({
              slug: `${model.provider}/${model.id}`,
              name: model.name?.trim() || `${model.provider}/${model.id}`,
              capabilities: defaultCapabilities(),
              isDiscovered: true,
            }))
            .toSorted((left, right) => left.name.localeCompare(right.name));

          const deduped = new Map(
            [
              {
                slug: "auto",
                name: "Auto (Pi default)",
                capabilities: defaultCapabilities(),
                isDiscovered: false,
              },
              ...models,
            ].map((option) => [option.slug, option]),
          );

          return {
            provider: "pi" as const,
            models: Array.from(deduped.values()),
          } satisfies ServerListProviderModelsResult;
        } catch {
          return fallbackModels("pi");
        }
      });

      yield* Ref.update(cacheRef, (cacheMap) => {
        const next = new Map(cacheMap);
        next.set(key, { expiresAt: now + PI_DISCOVERY_TTL_MS, result });
        return next;
      });
      return result;
    });

  const listModels: ProviderModelCatalogShape["listModels"] = (provider, providerOptions) =>
    (provider === "pi"
      ? listPiModels(providerOptions)
      : Effect.succeed(fallbackModels(provider))) as Effect.Effect<
      ServerListProviderModelsResult,
      ProviderServiceError
    >;

  return { listModels } satisfies ProviderModelCatalogShape;
});

export const ProviderModelCatalogLive = Layer.effect(
  ProviderModelCatalog,
  makeProviderModelCatalog,
);

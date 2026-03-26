import type {
  ProviderKind,
  ProviderStartOptions,
  ServerListProviderModelsResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProviderServiceError } from "../Errors.ts";

export interface ProviderModelCatalogShape {
  readonly listModels: (
    provider: ProviderKind,
    providerOptions?: ProviderStartOptions,
  ) => Effect.Effect<ServerListProviderModelsResult, ProviderServiceError>;
}

export class ProviderModelCatalog extends ServiceMap.Service<
  ProviderModelCatalog,
  ProviderModelCatalogShape
>()("t3/provider/Services/ProviderModelCatalog") {}

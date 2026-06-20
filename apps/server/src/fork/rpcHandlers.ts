import type { EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ReviewService } from "../review/ReviewService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { JiraApi } from "./jira/JiraApi.ts";
import { FORK_JIRA_REQUIRED_SCOPE, makeForkJiraHandlers } from "./jira/rpcHandlers.ts";
import {
  FORK_REVIEW_GROUPS_REQUIRED_SCOPE,
  makeForkReviewGroupsHandlers,
} from "./reviewGroups/rpcHandlers.ts";

export const FORK_RPC_REQUIRED_SCOPE = [
  ...FORK_JIRA_REQUIRED_SCOPE,
  ...FORK_REVIEW_GROUPS_REQUIRED_SCOPE,
] as const;

/** Mirrors the locally-bound `observeRpcEffect` helper in `ws.ts`. */
type ObserveRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;

export const makeForkRpcHandlers = (observeRpcEffect: ObserveRpcEffect) =>
  Effect.gen(function* () {
    const jira = yield* JiraApi;
    const review = yield* ReviewService;
    const providerInstances = yield* ProviderInstanceRegistry;
    const serverSettings = yield* ServerSettingsService;

    return {
      ...makeForkJiraHandlers(jira, observeRpcEffect),
      ...makeForkReviewGroupsHandlers(
        { review, providerInstances, serverSettings },
        observeRpcEffect,
      ),
    };
  });

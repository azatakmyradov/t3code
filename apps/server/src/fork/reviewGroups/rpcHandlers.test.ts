import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ReviewDiffPreviewResult,
  type ReviewDiffPreviewSource,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import type { ProviderInstance } from "../../provider/ProviderDriver.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";
import type {
  SemanticDiffGroupsCapability,
  SemanticDiffGroupsGenerationInput,
  SemanticDiffGroupsGenerationResult,
} from "./textGeneration.ts";
import {
  makeForkReviewGroupsHandlers,
  type ForkReviewGroupsDeps,
  type ObserveRpcEffect,
} from "./rpcHandlers.ts";

const WORKING_TREE_SOURCE: ReviewDiffPreviewSource = {
  id: "working-tree",
  kind: "working-tree",
  title: "Dirty worktree",
  baseRef: "HEAD",
  headRef: null,
  diff: "diff --git a/a.ts b/a.ts\n+change\n",
  diffHash: "hash-working",
  truncated: false,
};

const BRANCH_RANGE_SOURCE: ReviewDiffPreviewSource = {
  id: "branch-range",
  kind: "branch-range",
  title: "Against main",
  baseRef: "main",
  headRef: "feature",
  diff: "diff --git a/b.ts b/b.ts\n+other\n",
  diffHash: "hash-branch",
  truncated: false,
};

function makeDeps(options: {
  readonly sources: ReadonlyArray<ReviewDiffPreviewSource>;
  readonly settings: ServerSettings;
  readonly instances?: ReadonlyArray<ProviderInstance>;
}): ForkReviewGroupsDeps {
  const instances = new Map(
    (options.instances ?? []).map((instance) => [instance.instanceId, instance] as const),
  );
  return {
    review: {
      getDiffPreview: (input) =>
        Effect.map(
          DateTime.now,
          (generatedAt) =>
            ({
              cwd: input.cwd,
              generatedAt,
              sources: options.sources,
            }) satisfies ReviewDiffPreviewResult,
        ),
    },
    providerInstances: {
      getInstance: (instanceId) => Effect.succeed(instances.get(instanceId)),
    },
    serverSettings: {
      getSettings: Effect.succeed(options.settings),
    },
  };
}

// Identity observer mirroring the local `observeRpcEffect` helper in ws.ts.
const identityObserve: ObserveRpcEffect = (_method, effect) => effect;

function settingsWithReviewGroupsInstance(instanceId: string): ServerSettings {
  return {
    ...DEFAULT_SERVER_SETTINGS,
    fork: {
      ...DEFAULT_SERVER_SETTINGS.fork,
      reviewGroupsModelSelection: createModelSelection(
        ProviderInstanceId.make(instanceId),
        "some-model",
      ),
    },
  };
}

const makeCoreTextGeneration = (): TextGenerationShape => ({
  generateCommitMessage: () => Effect.die("generateCommitMessage stub not configured"),
  generatePrContent: () => Effect.die("generatePrContent stub not configured"),
  generateBranchName: () => Effect.die("generateBranchName stub not configured"),
  generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured"),
});

const makeSemanticTextGeneration = (
  onGenerate: (input: SemanticDiffGroupsGenerationInput) => void,
): TextGenerationShape & SemanticDiffGroupsCapability => ({
  ...makeCoreTextGeneration(),
  generateSemanticDiffGroups: (input) => {
    onGenerate(input);
    return Effect.succeed({ groups: [] } satisfies SemanticDiffGroupsGenerationResult);
  },
});

function makeProviderInstance(input: {
  readonly instanceId: string;
  readonly driverKind: string;
  readonly textGeneration: TextGenerationShape;
}): ProviderInstance {
  const instanceId = ProviderInstanceId.make(input.instanceId);
  const driverKind = ProviderDriverKind.make(input.driverKind);
  return {
    instanceId,
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: `${driverKind}:instance:${instanceId}`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {} as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration: input.textGeneration,
  };
}

describe("groupSemanticDiff handler", () => {
  it.effect("passes the selected source scope (working tree) to the generator", () =>
    Effect.gen(function* () {
      const calls: SemanticDiffGroupsGenerationInput[] = [];
      const handlers = makeForkReviewGroupsHandlers(
        makeDeps({
          sources: [WORKING_TREE_SOURCE, BRANCH_RANGE_SOURCE],
          settings: settingsWithReviewGroupsInstance("claudeAgent"),
          instances: [
            makeProviderInstance({
              instanceId: "claudeAgent",
              driverKind: "claudeAgent",
              textGeneration: makeSemanticTextGeneration((input) => calls.push(input)),
            }),
          ],
        }),
        identityObserve,
      );

      const result = yield* handlers["review.groupSemanticDiff"]({ cwd: "/repo" }).pipe(
        Effect.result,
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        cwd: "/repo",
        kind: "working-tree",
        baseRef: "HEAD",
        headRef: null,
      });
    }),
  );

  it.effect("passes the branch-range scope when that source is selected", () =>
    Effect.gen(function* () {
      const calls: SemanticDiffGroupsGenerationInput[] = [];
      const handlers = makeForkReviewGroupsHandlers(
        makeDeps({
          sources: [WORKING_TREE_SOURCE, BRANCH_RANGE_SOURCE],
          settings: settingsWithReviewGroupsInstance("codex"),
          instances: [
            makeProviderInstance({
              instanceId: "codex",
              driverKind: "codex",
              textGeneration: makeSemanticTextGeneration((input) => calls.push(input)),
            }),
          ],
        }),
        identityObserve,
      );

      yield* handlers["review.groupSemanticDiff"]({
        cwd: "/repo",
        sourceId: "branch-range",
      }).pipe(Effect.result);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        kind: "branch-range",
        baseRef: "main",
        headRef: "feature",
      });
    }),
  );

  it.effect("rejects unsupported providers without invoking the generator", () =>
    Effect.gen(function* () {
      const calls: SemanticDiffGroupsGenerationInput[] = [];
      const handlers = makeForkReviewGroupsHandlers(
        makeDeps({
          sources: [WORKING_TREE_SOURCE],
          settings: settingsWithReviewGroupsInstance("cursor"),
          instances: [
            makeProviderInstance({
              instanceId: "cursor",
              driverKind: "cursor",
              textGeneration: makeSemanticTextGeneration((input) => calls.push(input)),
            }),
          ],
        }),
        identityObserve,
      );

      const result = yield* handlers["review.groupSemanticDiff"]({ cwd: "/repo" }).pipe(
        Effect.result,
      );

      expect(calls).toHaveLength(0);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        const failure = result.failure;
        expect(failure._tag).toBe("TextGenerationError");
        if (failure._tag === "TextGenerationError") {
          expect(failure.detail).toContain("only supported for Claude and Codex");
        }
      }
    }),
  );

  it.effect("rejects missing provider instances without invoking generation", () =>
    Effect.gen(function* () {
      const handlers = makeForkReviewGroupsHandlers(
        makeDeps({
          sources: [WORKING_TREE_SOURCE],
          settings: settingsWithReviewGroupsInstance("missing_provider"),
        }),
        identityObserve,
      );

      const result = yield* handlers["review.groupSemanticDiff"]({ cwd: "/repo" }).pipe(
        Effect.result,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        const failure = result.failure;
        expect(failure._tag).toBe("TextGenerationError");
        if (failure._tag === "TextGenerationError") {
          expect(failure.detail).toContain("missing_provider");
        }
      }
    }),
  );

  it.effect("rejects supported providers missing the optional capability", () =>
    Effect.gen(function* () {
      const handlers = makeForkReviewGroupsHandlers(
        makeDeps({
          sources: [WORKING_TREE_SOURCE],
          settings: settingsWithReviewGroupsInstance("codex"),
          instances: [
            makeProviderInstance({
              instanceId: "codex",
              driverKind: "codex",
              textGeneration: makeCoreTextGeneration(),
            }),
          ],
        }),
        identityObserve,
      );

      const result = yield* handlers["review.groupSemanticDiff"]({ cwd: "/repo" }).pipe(
        Effect.result,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        const failure = result.failure;
        expect(failure._tag).toBe("TextGenerationError");
        if (failure._tag === "TextGenerationError") {
          expect(failure.detail).toContain("does not expose semantic diff grouping");
        }
      }
    }),
  );

  it.effect("short-circuits to empty groups when there is no diff", () =>
    Effect.gen(function* () {
      const calls: SemanticDiffGroupsGenerationInput[] = [];
      const handlers = makeForkReviewGroupsHandlers(
        makeDeps({
          sources: [{ ...WORKING_TREE_SOURCE, diff: "   " }],
          settings: settingsWithReviewGroupsInstance("cursor"),
        }),
        identityObserve,
      );

      const result = yield* handlers["review.groupSemanticDiff"]({ cwd: "/repo" }).pipe(
        Effect.result,
      );

      expect(calls).toHaveLength(0);
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.groups).toEqual([]);
      }
    }),
  );
});

import {
  EnvironmentId,
  type ReviewDiffPreviewSource,
  type ReviewSemanticGroupsResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  MAX_REVIEW_GROUP_CACHE_ENTRIES,
  REVIEW_SEMANTIC_GROUPS_CACHE_STORAGE_KEY,
  buildReviewSemanticGroupsCacheIdentity,
  buildReviewSemanticGroupsCacheKey,
  readReviewSemanticGroupsCache,
  writeReviewSemanticGroupsCache,
} from "./reviewGroupsCache";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function source(overrides: Partial<ReviewDiffPreviewSource> = {}): ReviewDiffPreviewSource {
  return {
    id: "working-tree",
    kind: "working-tree",
    title: "Working tree",
    baseRef: "HEAD",
    headRef: null,
    diff: "diff --git a/a.ts b/a.ts\n+const a = 1;\n",
    diffHash: "hash-1",
    truncated: false,
    ...overrides,
  };
}

function result(overrides: Partial<ReviewSemanticGroupsResult> = {}): ReviewSemanticGroupsResult {
  return {
    cwd: "/repo",
    generatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
    model: "model-a",
    truncated: false,
    groups: [
      {
        id: "group-1",
        title: "Runtime path",
        description: "Updates the runtime path.",
        whatChanged: "Changed one runtime file.",
        reviewFocus: "Check path handling.",
        risk: 42,
        riskLevel: "medium",
        riskReason: "Shared runtime code changed.",
        files: ["src/runtime.ts"],
      },
    ],
    ...overrides,
  };
}

function identity(input: {
  readonly source?: ReviewDiffPreviewSource;
  readonly modelSelectionKey?: string;
}) {
  return buildReviewSemanticGroupsCacheIdentity({
    environmentId: ENVIRONMENT_ID,
    cwd: "/repo",
    source: input.source ?? source(),
    modelSelectionKey: input.modelSelectionKey ?? "codex:gpt-5",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review semantic groups cache", () => {
  it("builds stable keys from environment, cwd, source, diff, and model", () => {
    expect(
      buildReviewSemanticGroupsCacheKey({
        environmentId: ENVIRONMENT_ID,
        cwd: "/repo",
        sourceId: "working-tree",
        diffHash: "hash-1",
        modelSelectionKey: "codex:gpt-5",
      }),
    ).toBe(JSON.stringify([ENVIRONMENT_ID, "/repo", "working-tree", "hash-1", "codex:gpt-5"]));
  });

  it("reads null when no cache entry exists", () => {
    const storage = createLocalStorageStub();

    expect(readReviewSemanticGroupsCache(identity({})!, { storage })).toBeNull();
  });

  it("writes and reads a ReviewSemanticGroupsResult round trip", () => {
    const storage = createLocalStorageStub();
    const cacheIdentity = identity({})!;
    const groupsResult = result();

    writeReviewSemanticGroupsCache(cacheIdentity, groupsResult, { storage, now: () => 1 });

    const cached = readReviewSemanticGroupsCache(cacheIdentity, { storage, now: () => 2 });
    expect(cached?.groups).toEqual(groupsResult.groups);
    expect(cached?.model).toBe("model-a");
    expect(cached?.generatedAt).toEqual(groupsResult.generatedAt);
  });

  it("misses when diffHash changes", () => {
    const storage = createLocalStorageStub();
    writeReviewSemanticGroupsCache(identity({})!, result(), { storage, now: () => 1 });

    expect(
      readReviewSemanticGroupsCache(identity({ source: source({ diffHash: "hash-2" }) })!, {
        storage,
      }),
    ).toBeNull();
  });

  it("misses when sourceId changes", () => {
    const storage = createLocalStorageStub();
    writeReviewSemanticGroupsCache(identity({})!, result(), { storage, now: () => 1 });

    expect(
      readReviewSemanticGroupsCache(identity({ source: source({ id: "branch-range" }) })!, {
        storage,
      }),
    ).toBeNull();
  });

  it("misses when modelSelectionKey changes", () => {
    const storage = createLocalStorageStub();
    writeReviewSemanticGroupsCache(identity({})!, result(), { storage, now: () => 1 });

    expect(
      readReviewSemanticGroupsCache(identity({ modelSelectionKey: "claude:opus" })!, { storage }),
    ).toBeNull();
  });

  it("prunes least-recently-used entries after 50 entries", () => {
    const storage = createLocalStorageStub();
    for (let index = 0; index < MAX_REVIEW_GROUP_CACHE_ENTRIES + 1; index += 1) {
      writeReviewSemanticGroupsCache(
        identity({ source: source({ id: `source-${index}`, diffHash: `hash-${index}` }) })!,
        result({ model: `model-${index}` }),
        { storage, now: () => index },
      );
    }

    expect(
      readReviewSemanticGroupsCache(
        identity({ source: source({ id: "source-0", diffHash: "hash-0" }) })!,
        { storage },
      ),
    ).toBeNull();
    expect(
      readReviewSemanticGroupsCache(
        identity({ source: source({ id: "source-1", diffHash: "hash-1" }) })!,
        { storage },
      )?.model,
    ).toBe("model-1");
    expect(
      readReviewSemanticGroupsCache(
        identity({ source: source({ id: "source-50", diffHash: "hash-50" }) })!,
        { storage },
      )?.model,
    ).toBe("model-50");
  });

  it("ignores corrupt localStorage payloads", () => {
    const storage = createLocalStorageStub();
    const cacheIdentity = identity({})!;
    storage.setItem(REVIEW_SEMANTIC_GROUPS_CACHE_STORAGE_KEY, "{not-json");

    expect(readReviewSemanticGroupsCache(cacheIdentity, { storage })).toBeNull();

    writeReviewSemanticGroupsCache(cacheIdentity, result(), { storage, now: () => 1 });
    expect(readReviewSemanticGroupsCache(cacheIdentity, { storage })?.groups).toHaveLength(1);
  });

  it("refuses cache identities for truncated sources", () => {
    const storage = createLocalStorageStub();
    const truncatedIdentity = identity({ source: source({ truncated: true }) });

    expect(truncatedIdentity).toBeNull();
    writeReviewSemanticGroupsCache(truncatedIdentity, result(), { storage, now: () => 1 });
    expect(storage.getItem(REVIEW_SEMANTIC_GROUPS_CACHE_STORAGE_KEY)).toBeNull();
    expect(readReviewSemanticGroupsCache(truncatedIdentity, { storage })).toBeNull();
  });
});

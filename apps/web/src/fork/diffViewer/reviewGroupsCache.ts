import {
  EnvironmentId,
  ReviewSemanticGroup,
  type EnvironmentId as EnvironmentIdType,
  type ReviewDiffPreviewSource,
  type ReviewSemanticGroupsResult as ReviewSemanticGroupsResultType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { resolveStorage, type StateStorage } from "~/lib/storage";

export const REVIEW_SEMANTIC_GROUPS_CACHE_STORAGE_KEY = "t3code:review-semantic-groups:v1";
export const MAX_REVIEW_GROUP_CACHE_ENTRIES = 50;

export interface ReviewSemanticGroupsCacheIdentity {
  readonly environmentId: EnvironmentIdType;
  readonly cwd: string;
  readonly sourceId: string;
  readonly diffHash: string;
  readonly modelSelectionKey: string;
  readonly key: string;
}

export interface ReviewSemanticGroupsCacheEntry extends ReviewSemanticGroupsCacheIdentity {
  readonly savedAtEpochMs: number;
  readonly lastAccessedAtEpochMs: number;
  readonly result: ReviewSemanticGroupsResultType;
}

interface ReviewSemanticGroupsCacheDocument {
  readonly version: 1;
  readonly entries: ReadonlyArray<ReviewSemanticGroupsCacheEntry>;
}

type ReviewGroupsCacheStorage = Pick<StateStorage, "getItem" | "setItem" | "removeItem">;

const ReviewSemanticGroupsCacheEntrySchema = Schema.Struct({
  key: Schema.String,
  environmentId: EnvironmentId,
  cwd: Schema.String,
  sourceId: Schema.String,
  diffHash: Schema.String,
  modelSelectionKey: Schema.String,
  savedAtEpochMs: Schema.Number,
  lastAccessedAtEpochMs: Schema.Number,
  result: Schema.Struct({
    cwd: Schema.String,
    generatedAt: Schema.DateTimeUtcFromString,
    model: Schema.NullOr(Schema.String),
    truncated: Schema.Boolean,
    groups: Schema.Array(ReviewSemanticGroup),
  }),
});

const ReviewSemanticGroupsCacheDocumentSchema = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(ReviewSemanticGroupsCacheEntrySchema),
});

const ReviewSemanticGroupsCacheDocumentJson = Schema.fromJsonString(
  ReviewSemanticGroupsCacheDocumentSchema,
);
const decodeReviewSemanticGroupsCacheDocument = Schema.decodeUnknownSync(
  ReviewSemanticGroupsCacheDocumentJson,
);
const encodeReviewSemanticGroupsCacheDocument = Schema.encodeSync(
  ReviewSemanticGroupsCacheDocumentJson,
);

function getBrowserLocalStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function resolveReviewGroupsCacheStorage(
  storage: ReviewGroupsCacheStorage | undefined,
): ReviewGroupsCacheStorage {
  return storage ?? resolveStorage(getBrowserLocalStorage());
}

function emptyCacheDocument(): ReviewSemanticGroupsCacheDocument {
  return { version: 1, entries: [] };
}

function readCacheDocument(storage: ReviewGroupsCacheStorage): ReviewSemanticGroupsCacheDocument {
  try {
    const raw = storage.getItem(REVIEW_SEMANTIC_GROUPS_CACHE_STORAGE_KEY);
    if (typeof raw !== "string") return emptyCacheDocument();
    return decodeReviewSemanticGroupsCacheDocument(raw);
  } catch {
    return emptyCacheDocument();
  }
}

function pruneCacheEntries(
  entries: ReadonlyArray<ReviewSemanticGroupsCacheEntry>,
  maxEntries: number,
): ReviewSemanticGroupsCacheEntry[] {
  return entries
    .toSorted((left, right) => right.lastAccessedAtEpochMs - left.lastAccessedAtEpochMs)
    .slice(0, maxEntries);
}

function writeCacheDocument(
  storage: ReviewGroupsCacheStorage,
  document: ReviewSemanticGroupsCacheDocument,
): boolean {
  try {
    storage.setItem(
      REVIEW_SEMANTIC_GROUPS_CACHE_STORAGE_KEY,
      encodeReviewSemanticGroupsCacheDocument(document),
    );
    return true;
  } catch {
    return false;
  }
}

function writeCacheDocumentWithRetry(
  storage: ReviewGroupsCacheStorage,
  document: ReviewSemanticGroupsCacheDocument,
): void {
  if (writeCacheDocument(storage, document)) return;

  const retryDocument: ReviewSemanticGroupsCacheDocument = {
    version: 1,
    entries: pruneCacheEntries(
      document.entries,
      Math.max(1, Math.floor(MAX_REVIEW_GROUP_CACHE_ENTRIES / 2)),
    ),
  };
  void writeCacheDocument(storage, retryDocument);
}

export function buildReviewSemanticGroupsModelSelectionKey(selection: {
  readonly instanceId: string;
  readonly model: string;
}): string {
  return `${selection.instanceId}:${selection.model}`;
}

export function buildReviewSemanticGroupsCacheKey(input: {
  readonly environmentId: EnvironmentIdType;
  readonly cwd: string;
  readonly sourceId: string;
  readonly diffHash: string;
  readonly modelSelectionKey: string;
}): string {
  return JSON.stringify([
    input.environmentId,
    input.cwd,
    input.sourceId,
    input.diffHash,
    input.modelSelectionKey,
  ]);
}

export function buildReviewSemanticGroupsCacheIdentity(input: {
  readonly environmentId: EnvironmentIdType;
  readonly cwd: string;
  readonly source: Pick<ReviewDiffPreviewSource, "id" | "diffHash" | "truncated"> | null;
  readonly modelSelectionKey: string;
}): ReviewSemanticGroupsCacheIdentity | null {
  if (!input.source || input.source.truncated) return null;
  const base = {
    environmentId: input.environmentId,
    cwd: input.cwd,
    sourceId: input.source.id,
    diffHash: input.source.diffHash,
    modelSelectionKey: input.modelSelectionKey,
  };
  return {
    ...base,
    key: buildReviewSemanticGroupsCacheKey(base),
  };
}

export function readReviewSemanticGroupsCache(
  identity: ReviewSemanticGroupsCacheIdentity | null,
  options?: {
    readonly storage?: ReviewGroupsCacheStorage;
    readonly now?: () => number;
    readonly updateLastAccess?: boolean;
  },
): ReviewSemanticGroupsResultType | null {
  if (!identity) return null;
  const storage = resolveReviewGroupsCacheStorage(options?.storage);
  const document = readCacheDocument(storage);
  const entry = document.entries.find((candidate) => candidate.key === identity.key);
  if (!entry) return null;
  if (options?.updateLastAccess === false) return entry.result;

  const now = options?.now?.() ?? Date.now();
  const updatedEntries = document.entries.map((candidate) =>
    candidate.key === identity.key ? { ...candidate, lastAccessedAtEpochMs: now } : candidate,
  );
  writeCacheDocumentWithRetry(storage, { version: 1, entries: updatedEntries });
  return entry.result;
}

export function writeReviewSemanticGroupsCache(
  identity: ReviewSemanticGroupsCacheIdentity | null,
  result: ReviewSemanticGroupsResultType,
  options?: { readonly storage?: ReviewGroupsCacheStorage; readonly now?: () => number },
): void {
  if (!identity) return;
  const storage = resolveReviewGroupsCacheStorage(options?.storage);
  const document = readCacheDocument(storage);
  const now = options?.now?.() ?? Date.now();
  const nextEntry: ReviewSemanticGroupsCacheEntry = {
    ...identity,
    savedAtEpochMs: now,
    lastAccessedAtEpochMs: now,
    result,
  };
  const entries = pruneCacheEntries(
    [nextEntry, ...document.entries.filter((entry) => entry.key !== identity.key)],
    MAX_REVIEW_GROUP_CACHE_ENTRIES,
  );
  writeCacheDocumentWithRetry(storage, { version: 1, entries });
}

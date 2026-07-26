import {
  SubagentId,
  type SubagentContextUsage,
  type SubagentLifecycle,
  type SubagentOutcome,
  type SubagentRelation,
  type SubagentStatus,
} from "@t3tools/fork-subagents/contracts";
import type { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const MAX_RUNNING_CHILDREN = 4;
const MIGRATION_ID = 1;
const MIGRATION_NAME = "initial";

export class SubagentRepositoryError extends Schema.TaggedErrorClass<SubagentRepositoryError>()(
  "SubagentRepositoryError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

interface RelationRow {
  readonly child_thread_id: string;
  readonly parent_thread_id: string;
  readonly display_id: string;
  readonly ordinal: number;
  readonly cwd: string;
  readonly prompt: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly provider_instance_id: string;
  readonly provider_driver: string;
  readonly model: string;
  readonly lifecycle: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly settled_at: string | null;
  readonly pending_approval: number;
  readonly pending_user_input: number;
  readonly turn_count: number;
  readonly context_usage_json: string | null;
  readonly error_text: string | null;
}

const repositoryError = (operation: string, cause: unknown) =>
  new SubagentRepositoryError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
  });

function decodeContextUsage(value: string | null): SubagentContextUsage | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SubagentContextUsage>;
    if (
      Number.isInteger(parsed.usedTokens) &&
      Number.isInteger(parsed.maxTokens) &&
      (parsed.usedTokens ?? -1) >= 0 &&
      (parsed.maxTokens ?? -1) >= 0
    ) {
      return {
        usedTokens: parsed.usedTokens!,
        maxTokens: parsed.maxTokens!,
      };
    }
  } catch {}
  return null;
}

function relationFromRow(row: RelationRow): SubagentRelation {
  return {
    childThreadId: row.child_thread_id as ThreadId,
    parentThreadId: row.parent_thread_id as ThreadId,
    displayId: SubagentId.make(row.display_id),
    ordinal: row.ordinal,
    cwd: row.cwd,
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerInstanceId: row.provider_instance_id as ProviderInstanceId,
    provider: row.provider_driver as ProviderDriverKind,
    model: row.model,
    lifecycle: row.lifecycle as SubagentLifecycle,
    status: row.status as SubagentStatus,
    outcome: row.outcome as SubagentOutcome | null,
    settledAt: row.settled_at,
    hasPendingApproval: row.pending_approval !== 0,
    hasPendingUserInput: row.pending_user_input !== 0,
    turnCount: row.turn_count,
    contextUsage: decodeContextUsage(row.context_usage_json),
    error: row.error_text,
  };
}

export interface ReserveSubagentInput {
  readonly childThreadId: ThreadId;
  readonly parentThreadId: ThreadId;
  readonly cwd: string;
  readonly prompt: string;
  readonly createdAt: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
  readonly model: string;
}

export interface UpdateSubagentProjectionInput {
  readonly childThreadId: ThreadId;
  readonly updatedAt: string;
  readonly lifecycle?: SubagentLifecycle;
  readonly status?: SubagentStatus;
  readonly outcome?: SubagentOutcome | null;
  readonly settledAt?: string | null;
  readonly hasPendingApproval?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly turnCount?: number;
  readonly contextUsage?: SubagentContextUsage | null;
  readonly error?: string | null;
}

export interface SubagentRepositoryShape {
  readonly reserve: (
    input: ReserveSubagentInput,
  ) => Effect.Effect<SubagentRelation, SubagentRepositoryError>;
  readonly activate: (
    childThreadId: ThreadId,
    updatedAt: string,
  ) => Effect.Effect<void, SubagentRepositoryError>;
  readonly release: (childThreadId: ThreadId) => Effect.Effect<void, SubagentRepositoryError>;
  readonly updateProjection: (
    input: UpdateSubagentProjectionInput,
  ) => Effect.Effect<void, SubagentRepositoryError>;
  readonly getByChildId: (
    childThreadId: ThreadId,
  ) => Effect.Effect<SubagentRelation | undefined, SubagentRepositoryError>;
  readonly listByParentId: (
    parentThreadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<SubagentRelation>, SubagentRepositoryError>;
  readonly listAll: () => Effect.Effect<ReadonlyArray<SubagentRelation>, SubagentRepositoryError>;
  readonly deleteByChildId: (
    childThreadId: ThreadId,
  ) => Effect.Effect<void, SubagentRepositoryError>;
}

export class SubagentRepository extends Context.Service<
  SubagentRepository,
  SubagentRepositoryShape
>()("t3/features/subagents/SubagentRepository") {}

export const runSubagentMigrations = Effect.fn("runSubagentMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_subagent_migrations (
      migration_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `;
  const applied = yield* sql<{ readonly migration_id: number }>`
    SELECT migration_id FROM fork_subagent_migrations
    WHERE migration_id = ${MIGRATION_ID}
  `;
  if (applied.length > 0) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS fork_subagent_threads (
          child_thread_id TEXT PRIMARY KEY,
          parent_thread_id TEXT NOT NULL,
          display_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          cwd TEXT NOT NULL,
          prompt TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provider_instance_id TEXT NOT NULL,
          provider_driver TEXT NOT NULL,
          model TEXT NOT NULL,
          lifecycle TEXT NOT NULL CHECK (lifecycle IN ('reserved', 'active', 'cleanup_pending')),
          status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN ('completed', 'failed', 'interrupted')),
          settled_at TEXT,
          pending_approval INTEGER NOT NULL DEFAULT 0,
          pending_user_input INTEGER NOT NULL DEFAULT 0,
          turn_count INTEGER NOT NULL DEFAULT 0,
          context_usage_json TEXT,
          error_text TEXT CHECK (error_text IS NULL OR length(error_text) <= 4096),
          UNIQUE(parent_thread_id, ordinal)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_fork_subagent_threads_parent
        ON fork_subagent_threads(parent_thread_id)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_fork_subagent_threads_reconcile
        ON fork_subagent_threads(lifecycle, status)
      `;
      yield* sql`
        INSERT INTO fork_subagent_migrations (migration_id, name, applied_at)
        VALUES (${MIGRATION_ID}, ${MIGRATION_NAME}, datetime('now'))
      `;
    }),
  );
});

const make = Effect.fn("SubagentRepository.make")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runSubagentMigrations();

  const getByChildId: SubagentRepositoryShape["getByChildId"] = (childThreadId) =>
    sql<RelationRow>`
      SELECT * FROM fork_subagent_threads
      WHERE child_thread_id = ${childThreadId}
    `.pipe(
      Effect.map((rows) => (rows[0] ? relationFromRow(rows[0]) : undefined)),
      Effect.mapError((cause) => repositoryError("getByChildId", cause)),
    );

  const listByParentId: SubagentRepositoryShape["listByParentId"] = (parentThreadId) =>
    sql<RelationRow>`
      SELECT * FROM fork_subagent_threads
      WHERE parent_thread_id = ${parentThreadId}
      ORDER BY created_at DESC, child_thread_id DESC
    `.pipe(
      Effect.map((rows) => rows.map(relationFromRow)),
      Effect.mapError((cause) => repositoryError("listByParentId", cause)),
    );

  const listAll: SubagentRepositoryShape["listAll"] = () =>
    sql<RelationRow>`
      SELECT * FROM fork_subagent_threads
      ORDER BY created_at ASC, child_thread_id ASC
    `.pipe(
      Effect.map((rows) => rows.map(relationFromRow)),
      Effect.mapError((cause) => repositoryError("listAll", cause)),
    );

  const reserve: SubagentRepositoryShape["reserve"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const running = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM fork_subagent_threads
            WHERE parent_thread_id = ${input.parentThreadId}
              AND lifecycle IN ('reserved', 'active')
              AND status = 'running'
          `;
          if ((running[0]?.count ?? 0) >= MAX_RUNNING_CHILDREN) {
            return yield* new SubagentRepositoryError({
              operation: "reserve",
              detail: "This parent already has four running subagents.",
            });
          }
          const ordinals = yield* sql<{ readonly ordinal: number }>`
            SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal
            FROM fork_subagent_threads
            WHERE parent_thread_id = ${input.parentThreadId}
          `;
          const ordinal = ordinals[0]?.ordinal ?? 1;
          const displayId = SubagentId.make(`sa-${ordinal}`);
          yield* sql`
            INSERT INTO fork_subagent_threads (
              child_thread_id, parent_thread_id, display_id, ordinal, cwd, prompt,
              created_at, updated_at, provider_instance_id, provider_driver, model,
              lifecycle, status, outcome, settled_at, pending_approval,
              pending_user_input, turn_count, context_usage_json, error_text
            ) VALUES (
              ${input.childThreadId}, ${input.parentThreadId}, ${displayId}, ${ordinal},
              ${input.cwd}, ${input.prompt}, ${input.createdAt}, ${input.createdAt},
              ${input.providerInstanceId}, ${input.provider}, ${input.model},
              'reserved', 'running', NULL, NULL, 0, 0, 0, NULL, NULL
            )
          `;
          return {
            childThreadId: input.childThreadId,
            parentThreadId: input.parentThreadId,
            displayId,
            ordinal,
            cwd: input.cwd,
            prompt: input.prompt,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
            providerInstanceId: input.providerInstanceId,
            provider: input.provider,
            model: input.model,
            lifecycle: "reserved",
            status: "running",
            outcome: null,
            settledAt: null,
            hasPendingApproval: false,
            hasPendingUserInput: false,
            turnCount: 0,
            contextUsage: null,
            error: null,
          } satisfies SubagentRelation;
        }),
      )
      .pipe(Effect.mapError((cause) => repositoryError("reserve", cause)));

  const activate: SubagentRepositoryShape["activate"] = (childThreadId, updatedAt) =>
    sql`
      UPDATE fork_subagent_threads
      SET lifecycle = 'active', updated_at = ${updatedAt}
      WHERE child_thread_id = ${childThreadId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => repositoryError("activate", cause)),
    );

  const release: SubagentRepositoryShape["release"] = (childThreadId) =>
    sql`
      DELETE FROM fork_subagent_threads
      WHERE child_thread_id = ${childThreadId} AND lifecycle = 'reserved'
    `.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => repositoryError("release", cause)),
    );

  const updateProjection: SubagentRepositoryShape["updateProjection"] = (input) =>
    getByChildId(input.childThreadId).pipe(
      Effect.flatMap((existing) => {
        if (!existing) return Effect.void;
        const contextUsage =
          input.contextUsage === undefined ? existing.contextUsage : input.contextUsage;
        return sql`
          UPDATE fork_subagent_threads SET
            updated_at = ${input.updatedAt},
            lifecycle = ${input.lifecycle ?? existing.lifecycle},
            status = ${input.status ?? existing.status},
            outcome = ${input.outcome === undefined ? existing.outcome : input.outcome},
            settled_at = ${input.settledAt === undefined ? existing.settledAt : input.settledAt},
            pending_approval = ${(input.hasPendingApproval ?? existing.hasPendingApproval) ? 1 : 0},
            pending_user_input = ${
              (input.hasPendingUserInput ?? existing.hasPendingUserInput) ? 1 : 0
            },
            turn_count = ${input.turnCount ?? existing.turnCount},
            context_usage_json = ${contextUsage === null ? null : JSON.stringify(contextUsage)},
            error_text = ${
              input.error === undefined ? existing.error : (input.error?.slice(0, 4_096) ?? null)
            }
          WHERE child_thread_id = ${input.childThreadId}
        `.pipe(Effect.asVoid);
      }),
      Effect.mapError((cause) =>
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        cause._tag === "SubagentRepositoryError"
          ? (cause as SubagentRepositoryError)
          : repositoryError("updateProjection", cause),
      ),
    );

  const deleteByChildId: SubagentRepositoryShape["deleteByChildId"] = (childThreadId) =>
    sql`
      DELETE FROM fork_subagent_threads
      WHERE child_thread_id = ${childThreadId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => repositoryError("deleteByChildId", cause)),
    );

  return SubagentRepository.of({
    reserve,
    activate,
    release,
    updateProjection,
    getByChildId,
    listByParentId,
    listAll,
    deleteByChildId,
  });
});

export const SubagentRepositoryLive = Layer.effect(SubagentRepository, make());

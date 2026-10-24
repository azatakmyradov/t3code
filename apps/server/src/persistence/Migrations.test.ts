import ShellStopRequestIndex from "./Migrations/069_ShellStopRequestIndex.ts";
import WebhookDedupe from "./Migrations/068_WebhookDedupe.ts";
import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import PullRequestReviewGuides from "./Migrations/062_PullRequestReviewGuides.ts";
import ThreadFailureLookupIndex from "./Migrations/063_ThreadFailureLookupIndex.ts";
import DropUnusedV1Projections from "./Migrations/064_DropUnusedV1Projections.ts";
import CanonicalizeThreadPullRequestLinks from "./Migrations/065_CanonicalizeThreadPullRequestLinks.ts";

import CodexUsageNativeTurnIndex from "./Migrations/066_CodexUsageNativeTurnIndex.ts";
import RepairClientSettlementTimestamps from "./Migrations/067_RepairClientSettlementTimestamps.ts";

const v2Migrations = migrationManifest.filter(([id]) => id >= 55);
const newerMigrationId = Math.max(...migrationManifest.map(([id]) => id)) + 1;

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

const failureIndexColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    PRAGMA index_info(orchestration_v2_projection_turn_items_failed_error_idx)
  `;
  return rows.map((row) => row.name);
});

const expectedFailureIndexColumns = [
  "thread_id",
  "run_id",
  "node_id",
  "updated_at",
  "ordinal",
  "turn_item_id",
];

const botTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND (name = 'bots' OR name LIKE 'bot_%')
    ORDER BY name
  `;
});

const seedUpstream = Effect.fn("seedUpstream")(function* (throughId: number) {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 60 });
  yield* PullRequestReviewGuides;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name, created_at)
    VALUES (61, 'PullRequestReviewGuides', '2026-10-01 12:00:00')
  `;
  yield* sql`
    INSERT INTO pull_request_review_guides (host, repository, number, guide_json)
    VALUES ('github.com', 'test/repo', 7, '{"title":"Saved review"}')
  `;
  if (throughId >= 62) {
    yield* ThreadFailureLookupIndex;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name, created_at)
      VALUES (62, 'ThreadFailureLookupIndex', '2026-10-02 12:00:00')
    `;
  }
  if (throughId >= 63) {
    yield* DropUnusedV1Projections;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (63, 'DropUnusedV1Projections', '2026-10-03 12:00:00')`;
  }
  if (throughId >= 64) {
    yield* CanonicalizeThreadPullRequestLinks;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (64, 'CanonicalizeThreadPullRequestLinks', '2026-10-04 12:00:00')`;
  }
  if (throughId >= 65) {
    yield* CodexUsageNativeTurnIndex;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (65, 'CodexUsageNativeTurnIndex', '2026-10-05 12:00:00')`;
  }
  if (throughId >= 66) {
    yield* RepairClientSettlementTimestamps;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (66, 'RepairClientSettlementTimestamps', '2026-10-06 12:00:00')`;
  }
  if (throughId >= 67) {
    yield* WebhookDedupe;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (67, 'WebhookDedupe', '2026-10-07 12:00:00')`;
  }
  if (throughId >= 68) {
    yield* ShellStopRequestIndex;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (68, 'ShellStopRequestIndex', '2026-10-08 12:00:00')`;
  }
});

describe("runMigrations", () => {
  it.effect("migrates a fresh database through the whole manifest", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
      assert.deepStrictEqual(yield* failureIndexColumns, expectedFailureIndexColumns);
      assert.lengthOf(yield* botTables, 5);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades schema 56 without changing saved review state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 56 });
      yield* sql`
        INSERT INTO pull_request_files_viewed
          (provider, host, repository, number, viewer, path, revision, viewed_at)
        VALUES ('github', 'github.com', 'test/repo', 7, 'reader', 'saved.ts', 'abc123', '2026-10-01')
      `;
      const before = yield* sql`SELECT * FROM pull_request_files_viewed`;

      assert.deepStrictEqual(
        yield* runMigrations(),
        migrationManifest.filter(([id]) => id > 56),
      );

      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* sql`SELECT * FROM pull_request_files_viewed`, before);
      assert.deepStrictEqual(yield* failureIndexColumns, expectedFailureIndexColumns);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([62, 63, 64, 65, 66, 67, 68])(
    "upgrades released fork %s while keeping bot and review data unchanged",
    (id) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: id });
        yield* sql`
        INSERT INTO bots (id, thread_id, revision, body)
        VALUES ('saved-bot', 'saved-thread', 3, '{"name":"Saved bot"}')
      `;
        yield* sql`
        INSERT INTO pull_request_review_guides (host, repository, number, guide_json)
        VALUES ('github.com', 'test/repo', 7, '{"title":"Saved review"}')
      `;
        const bots = yield* sql`SELECT * FROM bots`;
        const guides = yield* sql`SELECT * FROM pull_request_review_guides`;
        const releasedHistory =
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;

        assert.deepStrictEqual(
          yield* runMigrations(),
          migrationManifest.filter(([migrationId]) => migrationId > id),
        );

        assert.deepStrictEqual(yield* history, migrationManifest);
        assert.deepStrictEqual(yield* sql`SELECT * FROM bots`, bots);
        assert.deepStrictEqual(yield* sql`SELECT * FROM pull_request_review_guides`, guides);
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= ${id} ORDER BY migration_id`,
          releasedHistory,
        );
        assert.deepStrictEqual(yield* failureIndexColumns, expectedFailureIndexColumns);
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([61, 62, 63, 64, 65, 66, 67, 68])(
    "reconciles upstream %s without replaying its migrations",
    (id) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedUpstream(id);
        const guides = yield* sql`SELECT * FROM pull_request_review_guides`;
        const upstreamHistory = yield* sql<{
          readonly migration_id: number;
          readonly name: string;
          readonly created_at: string;
        }>`
        SELECT * FROM effect_sql_migrations WHERE migration_id >= 61 ORDER BY migration_id
      `;
        assert.deepStrictEqual(yield* botTables, []);

        assert.deepStrictEqual(yield* runMigrations(), [
          [61, "Bots"],
          ...migrationManifest.filter(([migrationId]) => migrationId > id + 1),
        ]);

        assert.deepStrictEqual(yield* history, migrationManifest);
        assert.deepStrictEqual(yield* sql`SELECT * FROM pull_request_review_guides`, guides);
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id >= 62 AND migration_id <= ${id + 1} ORDER BY migration_id`,
          upstreamHistory.map((row) => ({ ...row, migration_id: row.migration_id + 1 })),
        );
        assert.lengthOf(yield* botTables, 5);
        assert.deepStrictEqual(yield* failureIndexColumns, expectedFailureIndexColumns);
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([63, 64])("rolls back reconciliation when upstream %s has a ledger gap", (id) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedUpstream(id);
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 62`;
      const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const guides = yield* sql`SELECT * FROM pull_request_review_guides`;
      const exit = yield* Effect.exit(runMigrations());
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "63_ThreadFailureLookupIndex");
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        before,
      );
      assert.deepStrictEqual(yield* sql`SELECT * FROM pull_request_review_guides`, guides);
      assert.deepStrictEqual(yield* botTables, []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves unknown upstream histories untouched", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedUpstream(62);
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (63, 'UnknownUpstreamMigration')`;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "unexpected later migrations");
      assert.deepStrictEqual(yield* history, before);
      assert.deepStrictEqual(yield* botTables, []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("validates earlier V2 history before reconciling upstream ids", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedUpstream(61);
      yield* sql`UPDATE effect_sql_migrations SET name = 'UnknownMigration' WHERE migration_id = 60`;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "60_ThreadSnapshotWindowIndexes (recorded: UnknownMigration)");
      assert.deepStrictEqual(yield* history, before);
      assert.deepStrictEqual(yield* botTables, []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([62, 63, 64, 65, 66])(
    "does not reconcile upstream %s beyond the requested migration limit",
    (id) =>
      Effect.gen(function* () {
        yield* seedUpstream(id);
        const before = yield* history;
        assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 60 }), []);

        const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive: id }));

        assert.isTrue(Exit.isFailure(exit));
        assert.deepStrictEqual(yield* history, before);
        assert.deepStrictEqual(yield* botTables, []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rolls back upstream reconciliation if creating the fork schema fails", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedUpstream(62);
      // Force Bots to fail after creating its first table, exercising transaction rollback.
      yield* sql`CREATE TABLE bot_tasks (existing_data TEXT)`;
      yield* sql`INSERT INTO bot_tasks VALUES ('keep me')`;
      const before = yield* history;
      const tablesBefore = yield* botTables;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(yield* history, before);
      assert.deepStrictEqual(yield* botTables, tablesBefore);
      assert.deepStrictEqual(yield* sql`SELECT * FROM bot_tasks`, [{ existing_data: "keep me" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when another migration took a V2 id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'FutureMainMigration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 54 }), []);
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "55_OrchestrationV2 (recorded: FutureMainMigration)");
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when a later id would skip V2 migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'FutureMainMigration')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      for (const [id, name] of v2Migrations) {
        assert.include(String(exit), `${id}_${name} (recorded: nothing)`);
      }
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades a database at exactly 54", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 54 });
      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([30, 54])("still starts with a site-local migration at id %s", (id) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'SiteLocalMigration' WHERE migration_id = ${id}
      `;

      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("only checks V2 migrations within the requested limit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (56, 'SiteLocalMigration'), (${newerMigrationId}, 'NewerV2Migration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 55 }), []);
      const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive: 56 }));
      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        String(exit),
        "56_RemoveRedundantProjectionIndexes (recorded: SiteLocalMigration)",
      );
      assert.notInclude(String(exit), "57_ScheduledTaskWebhooks");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("still starts after a newer build recorded a later V2 migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'NewerV2Migration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

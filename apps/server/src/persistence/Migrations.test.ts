import ShellStopRequestIndex from "./Migrations/069_ShellStopRequestIndex.ts";
import WebhookDedupe from "./Migrations/068_WebhookDedupe.ts";
import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import PeerLinks from "./Migrations/071_PeerLinks.ts";
import PeerLinkFence from "./Migrations/072_PeerLinkFence.ts";
import WaitingLinkRequestIndex from "./Migrations/073_WaitingLinkRequestIndex.ts";
import ActiveTurnItemIndexes from "./Migrations/074_ActiveTurnItemIndexes.ts";
import ExcludeAttachmentPlaceholdersFromSearch from "./Migrations/075_ExcludeAttachmentPlaceholdersFromSearch.ts";
import SubagentDeliveryState from "./Migrations/076_SubagentDeliveryState.ts";

import ThreadMessageSearch from "./Migrations/070_ThreadMessageSearch.ts";

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
  if (throughId >= 69) {
    yield* ThreadMessageSearch;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (69, 'ThreadMessageSearch', '2026-10-09 12:00:00')`;
  }
  if (throughId >= 70) {
    yield* PeerLinks;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (70, 'PeerLinks', '2026-10-10 12:00:00')`;
  }
  if (throughId >= 71) {
    yield* PeerLinkFence;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (71, 'PeerLinkFence', '2026-10-11 12:00:00')`;
    yield* sql`INSERT INTO peer_environment_links (environment_id, secret_name, label, urls_json, access, linked_at, expires_at, fenced) VALUES ('saved-peer', 'fixture-placeholder', 'Saved peer', '[]', 'read', '2026-10-11', '2026-11-11', 1)`;
  }
  if (throughId >= 72) {
    yield* WaitingLinkRequestIndex;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (72, 'WaitingLinkRequestIndex', '2026-10-12 12:00:00')`;
  }
  if (throughId >= 73) {
    yield* ActiveTurnItemIndexes;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (73, 'ActiveTurnItemIndexes', '2026-10-13 12:00:00')`;
  }
  if (throughId >= 74) {
    yield* ExcludeAttachmentPlaceholdersFromSearch;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (74, 'ExcludeAttachmentPlaceholdersFromSearch', '2026-10-14 12:00:00')`;
  }
  if (throughId >= 75) {
    yield* SubagentDeliveryState;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (75, 'SubagentDeliveryState', '2026-10-15 12:00:00')`;
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

  it.effect.each(Array.from({ length: 74 }, (_, index) => index + 1))(
    "upgrades released fork %s while keeping bot and review data unchanged",
    (id) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: id });
        if (id >= 61)
          yield* sql`
        INSERT INTO bots (id, thread_id, revision, body)
        VALUES ('saved-bot', 'saved-thread', 3, '{"name":"Saved bot"}')
      `;
        if (id >= 62)
          yield* sql`
        INSERT INTO pull_request_review_guides (host, repository, number, guide_json)
        VALUES ('github.com', 'test/repo', 7, '{"title":"Saved review"}')
      `;
        const bots = id >= 61 ? yield* sql`SELECT * FROM bots` : [];
        const guides = id >= 62 ? yield* sql`SELECT * FROM pull_request_review_guides` : [];
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

  it.effect.each([61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75])(
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
        const peers = id >= 71 ? yield* sql`SELECT * FROM peer_environment_links` : [];
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
        assert.deepStrictEqual(yield* sql`SELECT * FROM peer_environment_links`, peers);
        assert.lengthOf(yield* botTables, 5);
        assert.deepStrictEqual(yield* failureIndexColumns, expectedFailureIndexColumns);
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([69, 70, 71, 72, "fork"] as const)(
    "preserves existing %s message search without replaying it",
    (source) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        if (source !== "fork") {
          yield* seedUpstream(source);
        } else {
          yield* runMigrations({ toMigrationInclusive: 70 });
        }
        // This indexed row has no message to backfill, so rebuilding would lose it.
        yield* sql`INSERT INTO orchestration_v2_message_search (rowid, text) VALUES (42, 'saved search needle')`;
        const searchSchema = yield* sql`
          SELECT name, rootpage, sql FROM sqlite_master
          WHERE name LIKE 'orchestration_v2_message_search%' OR sql LIKE '%orchestration_v2_message_search%' ORDER BY name
        `;
        const searchHistory = yield* sql<{ readonly created_at: string }>`
          SELECT created_at FROM effect_sql_migrations WHERE name = 'ThreadMessageSearch'
        `;

        assert.deepStrictEqual(yield* runMigrations(), [
          ...(source !== "fork" ? [[61, "Bots"] as const] : []),
          ...migrationManifest.filter(([id]) => id > (source === "fork" ? 70 : source + 1)),
        ]);
        assert.deepStrictEqual(yield* history, migrationManifest);
        assert.deepStrictEqual(
          yield* sql`
          SELECT created_at FROM effect_sql_migrations WHERE migration_id = 70 AND name = 'ThreadMessageSearch'
        `,
          searchHistory,
        );
        assert.deepStrictEqual(
          yield* sql`
          SELECT name, rootpage, sql FROM sqlite_master
          WHERE name LIKE 'orchestration_v2_message_search%' OR sql LIKE '%orchestration_v2_message_search%' ORDER BY name
        `,
          searchSchema,
        );
        assert.deepStrictEqual(
          yield* sql`
          SELECT rowid FROM orchestration_v2_message_search WHERE orchestration_v2_message_search MATCH 'needle'
        `,
          [{ rowid: 42 }],
        );
        const normalizedHistory =
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 69 }), []);
        assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 70 }), []);
        assert.deepStrictEqual(yield* runMigrations(), []);
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
          normalizedHistory,
        );
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

  it.effect.each([69, 70, 71, 72])("rejects upstream 72 with a gap at %s atomically", (missingId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedUpstream(72);
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${missingId}`;
      const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const schema = yield* sql`SELECT * FROM sqlite_master ORDER BY name`;
      assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        before,
      );
      assert.deepStrictEqual(yield* sql`SELECT * FROM sqlite_master ORDER BY name`, schema);
      assert.deepStrictEqual(yield* botTables, []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([70, 71, 72, 73])(
    "rejects an unknown or occupied upstream destination at %s atomically",
    (id) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedUpstream(72);
        yield* sql`INSERT OR REPLACE INTO effect_sql_migrations (migration_id, name, created_at) VALUES (${id}, 'UnknownMigration', '2026-10-20')`;
        const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        const schema = yield* sql`SELECT * FROM sqlite_master ORDER BY name`;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
          before,
        );
        assert.deepStrictEqual(yield* sql`SELECT * FROM sqlite_master ORDER BY name`, schema);
        assert.deepStrictEqual(yield* botTables, []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each(["gap", "unknown"] as const)(
    "rejects upstream 72 with an earlier %s without rewriting history",
    (kind) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedUpstream(72);
        if (kind === "gap") yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 54`;
        else
          yield* sql`UPDATE effect_sql_migrations SET name = 'UnknownMigration' WHERE migration_id = 54`;
        const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        const schema = yield* sql`SELECT * FROM sqlite_master ORDER BY name`;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
          before,
        );
        assert.deepStrictEqual(yield* sql`SELECT * FROM sqlite_master ORDER BY name`, schema);
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

  it.effect.each([62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75])(
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

// The npm launcher reads the highest migration id from these file names.
it.effect("registers every migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "Migrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [[Number(match[1]), match[2]] as const] : [];
    });
    assert.deepStrictEqual(
      files.toSorted(([a], [b]) => a - b),
      migrationManifest,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

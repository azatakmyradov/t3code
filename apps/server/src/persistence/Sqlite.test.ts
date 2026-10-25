// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { WAL_SIZE_LIMIT_BYTES } from "./Sqlite.ts";
import * as SqlitePersistence from "./Sqlite.ts";
import { runMigrations } from "./Migrations.ts";

const lockHolderSource = `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("BEGIN IMMEDIATE");
process.stdout.write("locked\\n");
setTimeout(() => {
  db.exec("COMMIT");
  db.close();
}, Number(process.argv[2]));
`;

const spawnWriteLockHolder = (dbPath: string, holdMs: number) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const holder = NodeChildProcess.spawn(
          process.execPath,
          ["-e", lockHolderSource, dbPath, String(holdMs)],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        holder.stdout.once("data", () => resolve());
        holder.on("error", reject);
        holder.on("exit", () =>
          reject(new Error("lock holder exited before acquiring the write lock")),
        );
      }),
  );

it.effect("waits out a concurrent writer instead of failing with SQLITE_BUSY", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-busy-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE busy_probe(id INTEGER PRIMARY KEY)`;
    yield* spawnWriteLockHolder(dbPath, 300);
    yield* sql`INSERT INTO busy_probe(id) VALUES (${1})`;
    const rows = yield* sql<{ readonly id: number }>`SELECT id FROM busy_probe`;
    assert.deepEqual([...rows], [{ id: 1 }]);
  }).pipe(
    Effect.provide(SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("limits the WAL file size in the shared persistence setup", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly journal_size_limit: number }>`PRAGMA journal_size_limit`;
    assert.equal(rows[0]?.journal_size_limit, WAL_SIZE_LIMIT_BYTES);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("drops planner statistics a database already has", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-stats-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const persistence = () =>
    SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer));

  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE walk_probe(node_id TEXT PRIMARY KEY, parent_node_id TEXT)`;
      yield* sql`INSERT INTO walk_probe VALUES ('node-1', NULL), ('node-2', 'node-1')`;
      yield* sql`ANALYZE walk_probe`;
    }).pipe(Effect.provide(persistence()));

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const stats = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM sqlite_stat1
      `;
      assert.equal(stats[0]?.count, 0);
      // A connection still using the old stats scans the table at each step.
      const plan = yield* sql<{ readonly detail: string }>`
        EXPLAIN QUERY PLAN
        WITH RECURSIVE retained(node_id) AS (
          SELECT 'node-2'
          UNION
          SELECT parent.parent_node_id FROM walk_probe AS parent
          INNER JOIN retained ON parent.node_id = retained.node_id
        )
        SELECT node_id FROM retained
      `;
      assert.include(
        plan.map((row) => row.detail),
        "SEARCH parent USING INDEX sqlite_autoindex_walk_probe_1 (node_id=?)",
      );
    }).pipe(Effect.provide(persistence()));
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("only fsyncs the database file at WAL checkpoints", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-sync-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly synchronous: number }>`PRAGMA synchronous`;
    assert.equal(rows[0]?.synchronous, 1);
  }).pipe(
    Effect.provide(SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer))),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("applies busy_timeout in the shared persistence setup", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout`;
    assert.equal(rows[0]?.timeout, 5000);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("preserves released bot data and migration history", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-retired-bots-"));
  const dbPath = NodePath.join(tempDir, "statev2.sqlite");
  const readBotData = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      bots: yield* sql`SELECT * FROM bots`,
      tasks: yield* sql`SELECT * FROM bot_tasks`,
      requests: yield* sql`SELECT * FROM bot_requests`,
      messages: yield* sql`SELECT * FROM bot_messages`,
      connections: yield* sql`SELECT * FROM bot_connections`,
      schema: yield* sql`
        SELECT name, sql FROM sqlite_master
        WHERE name = 'bots' OR name LIKE 'bot_%'
        ORDER BY name
      `,
      migrations: yield* sql`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `,
    };
  });
  const seedReleasedDatabase = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 61 });
    yield* sql`
      INSERT INTO bots (id, thread_id, revision, body)
      VALUES ('saved-bot', 'saved-bot-main', 3, '{"name":"Saved bot","notes":"Keep me"}')
    `;
    yield* sql`
      INSERT INTO bot_tasks
        (id, bot_id, thread_id, reported, body, guest_context, guest_session, guest_expires, launch_input)
      VALUES ('saved-task', 'saved-bot', 'saved-task-thread', 0, '{"status":"pending"}',
        '{"environmentId":"remote"}', 'stored-session', '2026-10-11T00:00:00.000Z',
        '{"prompt":"Saved work"}')
    `;
    yield* sql`
      INSERT INTO bot_requests (id, sender_bot_id, target_bot_id, text, reply, delivered)
      VALUES ('saved-request', 'saved-bot', 'other-bot', 'Saved request', NULL, 0)
    `;
    yield* sql`
      INSERT INTO bot_messages (id, bot_id, body, pending)
      VALUES ('saved-message', 'saved-bot', '{"text":"Saved message"}', 1)
    `;
    yield* sql`
      INSERT INTO bot_connections (bot_id, environment_id, body)
      VALUES ('saved-bot', 'remote', '{"name":"Saved connection"}')
    `;
    return yield* readBotData;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));

  return Effect.gen(function* () {
    const before = yield* seedReleasedDatabase;
    // Reopen through the same setup used by the server, with no bot service loaded.
    const after = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO pull_request_review_guides (host, repository, number, guide_json)
        VALUES ('github.com', 'test/repo', 1, '{}')
      `;
      assert.deepStrictEqual(
        yield* sql`SELECT repository, number FROM pull_request_review_guides`,
        [{ repository: "test/repo", number: 1 }],
      );
      return yield* readBotData;
    }).pipe(
      Effect.provide(
        SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer)),
      ),
    );
    assert.deepStrictEqual(after, {
      ...before,
      migrations: [
        ...before.migrations,
        { migration_id: 62, name: "PullRequestReviewGuides" },
        { migration_id: 63, name: "ThreadFailureLookupIndex" },
        { migration_id: 64, name: "DropUnusedV1Projections" },
        { migration_id: 65, name: "CanonicalizeThreadPullRequestLinks" },
        { migration_id: 66, name: "CodexUsageNativeTurnIndex" },
        { migration_id: 67, name: "RepairClientSettlementTimestamps" },
        { migration_id: 68, name: "WebhookDedupe" },
        { migration_id: 69, name: "ShellStopRequestIndex" },
        { migration_id: 70, name: "ThreadMessageSearch" },
      ],
    });
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("enables checkpoint_fullfsync in the shared persistence setup", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly checkpoint_fullfsync: number;
    }>`PRAGMA checkpoint_fullfsync`;
    assert.equal(rows[0]?.checkpoint_fullfsync, 1);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

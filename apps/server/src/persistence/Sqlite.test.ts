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

it.effect("shrinks the WAL file back to the size limit after a large write", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sqlite-wal-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const walFileSize = () => NodeFS.statSync(`${dbPath}-wal`).size;
  // About 25% more 4 KB rows than the limit holds, in one transaction.
  const rowCount = Math.ceil((WAL_SIZE_LIMIT_BYTES * 1.25) / 4000);

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE wal_probe(payload BLOB)`;
    yield* sql`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${rowCount})
      INSERT INTO wal_probe(payload) SELECT randomblob(4000) FROM n
    `;
    assert.isAbove(walFileSize(), WAL_SIZE_LIMIT_BYTES);

    // The auto-checkpoint after the large commit copied every frame into the
    // database, so the next commit restarts the WAL and cuts the file back.
    yield* sql`INSERT INTO wal_probe(payload) VALUES (x'00')`;
    assert.isAtMost(walFileSize(), WAL_SIZE_LIMIT_BYTES);
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

it.effect("preserves released bot data when starting an already upgraded database", () => {
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
    const after = yield* readBotData.pipe(
      Effect.provide(
        SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer)),
      ),
    );
    assert.deepStrictEqual(after, before);
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

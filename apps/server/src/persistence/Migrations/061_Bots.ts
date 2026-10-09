import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bots (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE bot_tasks (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, thread_id TEXT UNIQUE, reported INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, guest_context TEXT, guest_session TEXT, guest_expires TEXT, launch_input TEXT)`;
  yield* sql`CREATE INDEX bot_tasks_bot ON bot_tasks(bot_id)`;
  yield* sql`CREATE INDEX bot_tasks_pending ON bot_tasks(reported) WHERE reported = 0`;
  yield* sql`CREATE TABLE bot_requests (id TEXT PRIMARY KEY, sender_bot_id TEXT NOT NULL, target_bot_id TEXT NOT NULL, text TEXT NOT NULL, reply TEXT, delivered INTEGER NOT NULL DEFAULT 0)`;
  yield* sql`CREATE TABLE bot_messages (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, body TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0)`;
  yield* sql`CREATE INDEX bot_messages_bot ON bot_messages(bot_id, id)`;
  yield* sql`CREATE INDEX bot_messages_pending ON bot_messages(pending) WHERE pending = 1`;
  yield* sql`CREATE TABLE bot_connections (bot_id TEXT NOT NULL, environment_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(bot_id, environment_id))`;
});

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Retained bot conversations and their descendants cannot resume without the bot runtime. */
export const isRetiredBotThread = Effect.fn("isRetiredBotThread")(function* (threadId: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    WITH RECURSIVE ancestors(thread_id) AS (
      SELECT ${threadId}
      UNION
      SELECT json_extract(thread.payload_json, '$.lineage.parentThreadId')
      FROM orchestration_v2_projection_threads AS thread
      JOIN ancestors ON thread.thread_id = ancestors.thread_id
      WHERE json_extract(thread.payload_json, '$.lineage.parentThreadId') IS NOT NULL
    )
    SELECT 1 FROM ancestors
    WHERE thread_id GLOB 'bot:profile:*:main'
      OR thread_id GLOB 'bot:task:*:thread'
      OR EXISTS (SELECT 1 FROM bots WHERE bots.thread_id = ancestors.thread_id)
      OR EXISTS (SELECT 1 FROM bot_tasks WHERE bot_tasks.thread_id = ancestors.thread_id)
    LIMIT 1
  `;
  return rows.length !== 0;
});

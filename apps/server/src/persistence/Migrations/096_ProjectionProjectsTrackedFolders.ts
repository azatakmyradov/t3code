import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Upstream ships this column under another migration id; either may run first.
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  if (columns.some((column) => column.name === "tracked_folders_json")) return;
  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN tracked_folders_json TEXT NOT NULL DEFAULT '[]'
  `;
});

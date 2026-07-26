import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("035_RepairProjectionThreadsSnoozed", (it) => {
  it.effect("restores snooze columns when migration 34 was recorded without them", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`ALTER TABLE projection_threads DROP COLUMN snoozed_until`;
      yield* sql`ALTER TABLE projection_threads DROP COLUMN snoozed_at`;

      yield* runMigrations({ toMigrationInclusive: 35 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "snoozed_until"));
      assert.ok(columns.some((column) => column.name === "snoozed_at"));
    }),
  );
});

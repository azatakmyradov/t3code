import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SubagentRepository, SubagentRepositoryLive } from "./SubagentRepository.ts";

const repositoryLayer = it.layer(
  Layer.mergeAll(
    SubagentRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const reserveInput = (parent: string, child: number) => ({
  childThreadId: ThreadId.make(`t3-internal-subagent-${parent}-${child}`),
  parentThreadId: ThreadId.make(parent),
  cwd: "/tmp/project",
  prompt: `task ${child}`,
  createdAt: `2026-07-22T00:00:0${child}.000Z`,
  providerInstanceId: ProviderInstanceId.make("codex"),
  provider: ProviderDriverKind.make("codex"),
  model: "gpt-5",
});

repositoryLayer("SubagentRepository", (it) => {
  it.effect("uses a feature ledger without altering projection_threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* SubagentRepository;

      const migrations = yield* sql<{ readonly name: string }>`
        SELECT name FROM fork_subagent_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [{ name: "initial" }]);

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      const names = new Set(columns.map((column) => column.name));
      assert.strictEqual(names.has("parent_thread_id"), false);
      assert.strictEqual(names.has("subagent_running_count"), false);
    }),
  );

  it.effect("allocates unique ordinals transactionally and rejects a fifth live child", () =>
    Effect.gen(function* () {
      const repository = yield* SubagentRepository;
      const results = yield* Effect.forEach(
        [1, 2, 3, 4, 5],
        (child) => repository.reserve(reserveInput("parent-concurrent", child)).pipe(Effect.result),
        { concurrency: "unbounded" },
      );
      const successes = results.filter(Result.isSuccess).map((result) => result.success);
      const failures = results.filter(Result.isFailure);

      assert.deepStrictEqual(
        successes.map((relation) => relation.ordinal).toSorted(),
        [1, 2, 3, 4],
      );
      assert.strictEqual(failures.length, 1);
    }),
  );

  it.effect("releases a failed reservation", () =>
    Effect.gen(function* () {
      const repository = yield* SubagentRepository;
      const reserved = yield* repository.reserve(reserveInput("parent-release", 1));
      yield* repository.release(reserved.childThreadId);
      assert.strictEqual(yield* repository.getByChildId(reserved.childThreadId), undefined);
    }),
  );
});

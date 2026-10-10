import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ScheduledTaskId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const now = "2026-10-10T12:00:00.000Z";

const seedTask = (
  sql: SqlClient.SqlClient,
  id: string,
  options: { threadId?: string; status?: string; schedule?: string; next?: string } = {},
) =>
  sql`INSERT INTO scheduled_tasks ${sql.insert({
    task_id: id,
    title: id,
    prompt: "Keep this saved prompt.",
    enabled: 1,
    schedule_json: options.schedule ?? '{"type":"interval","everyMs":60000}',
    project_id: "project:test",
    thread_id: options.threadId ?? null,
    workspace_strategy_json: '{"type":"root"}',
    model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
    runtime_mode: "full-access",
    interaction_mode: "default",
    created_by: "user",
    creation_source: "web",
    created_at: now,
    updated_at: now,
    next_run_at: options.next ?? now,
    last_run_at: null,
    last_run_status: options.status ?? "never",
    last_run_error: null,
    run_count: 0,
  })}`;

const seedParent = (sql: SqlClient.SqlClient, threadId: string, parentThreadId: string) =>
  sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
    thread_id: threadId,
    project_id: "project:test",
    title: threadId,
    default_provider: "codex",
    runtime_mode: "full-access",
    interaction_mode: "default",
    created_at: now,
    updated_at: now,
    payload_json: JSON.stringify({ lineage: { parentThreadId } }),
  })}`;

const serviceLayer = (dispatched: string[], runDueAtStart = false) =>
  ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        Layer.mock(Scheduler.Scheduler)({
          // A completed registered pass is a deterministic receipt, with no sleeps or polling.
          register: (_name, runDueWork) => (runDueAtStart ? Effect.orDie(runDueWork) : Effect.void),
        }),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (input) =>
            Effect.sync(() => dispatched.push(input.title)).pipe(
              Effect.andThen(Effect.die("test launch failure")),
            ),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          sendToThread: (input) =>
            Effect.sync(() => dispatched.push(input.threadId)).pipe(
              Effect.andThen(Effect.die("test send failure")),
            ),
        }),
        Layer.mock(SecretRequests.SecretRequests)({}),
      ),
    ),
  );

it.effect("excludes retained bot schedules and descendants without changing their saved data", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO bots (id, thread_id, revision, body)
      VALUES ('saved-bot', 'saved-main', 1, '{"memory":"Keep this memory."}')`;
    yield* sql`INSERT INTO bot_tasks (id, bot_id, thread_id, body)
      VALUES ('saved-task-id', 'saved-bot', 'saved-task', '{"result":"Keep this result."}')`;
    yield* seedParent(sql, "delegated-child", "saved-task");
    yield* seedParent(sql, "ordinary-cycle-a", "ordinary-cycle-b");
    yield* seedParent(sql, "ordinary-cycle-b", "ordinary-cycle-a");
    for (const [id, threadId] of [
      ["bot:check-in:removed", undefined],
      ["scheduled-task:bot:schedule:removed:daily", undefined],
      ["bot-main", "bot:profile:removed:main"],
      ["bot-task", "bot:task:removed:job:thread"],
      ["owned-main", "saved-main"],
      ["owned-task", "saved-task"],
      ["descendant", "delegated-child"],
      ["ordinary-unbound", undefined],
      ["ordinary-cycle", "ordinary-cycle-a"],
    ] as const) {
      yield* seedTask(sql, id, threadId === undefined ? {} : { threadId });
    }
    const before = yield* sql`SELECT * FROM scheduled_tasks ORDER BY task_id`;
    const bots = yield* sql`SELECT * FROM bots`;
    const botTasks = yield* sql`SELECT * FROM bot_tasks`;
    const due = yield* ScheduledTaskService.listDueTasks(DateTime.makeUnsafe(now));
    assert.deepEqual(
      due.map((task) => task.id),
      ["ordinary-cycle", "ordinary-unbound"],
    );
    assert.deepEqual(yield* sql`SELECT * FROM scheduled_tasks ORDER BY task_id`, before);
    assert.deepEqual(yield* sql`SELECT * FROM bots`, bots);
    assert.deepEqual(yield* sql`SELECT * FROM bot_tasks`, botTasks);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "startup leaves interrupted bot schedules intact while ordinary recovery and runs continue",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* TestClock.setTime(Date.parse(now));
      yield* seedTask(sql, "bot-running", {
        threadId: "bot:profile:saved:main",
        status: "running",
      });
      yield* seedTask(sql, "bot-due", { threadId: "bot:profile:saved:main" });
      yield* seedTask(sql, "bot-missed", {
        threadId: "bot:profile:saved:main",
        schedule: '{"type":"fixed_time","timeOfDay":"09:00"}',
        next: "2026-10-09T09:00:00.000Z",
      });
      yield* seedTask(sql, "ordinary-running", { status: "running" });
      yield* seedTask(sql, "ordinary-due");
      const before =
        yield* sql`SELECT * FROM scheduled_tasks WHERE task_id GLOB 'bot-*' ORDER BY task_id`;
      const dispatched: string[] = [];
      yield* Effect.gen(function* () {
        yield* ScheduledTaskService.ScheduledTaskService;
        assert.deepEqual(dispatched, ["ordinary-due"]);
        assert.deepEqual(
          yield* sql`SELECT * FROM scheduled_tasks WHERE task_id GLOB 'bot-*' ORDER BY task_id`,
          before,
        );
        const ordinary = yield* sql<{
          task_id: string;
          last_run_status: string;
          run_count: number;
        }>`
        SELECT task_id, last_run_status, run_count FROM scheduled_tasks
        WHERE task_id GLOB 'ordinary-*' ORDER BY task_id
      `;
        assert.deepEqual(ordinary, [
          { task_id: "ordinary-due", last_run_status: "failed", run_count: 1 },
          { task_id: "ordinary-running", last_run_status: "failed", run_count: 1 },
        ]);
      }).pipe(Effect.provide(serviceLayer(dispatched, true)));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "manual runs cannot revive bot routines, including interrupted or re-enabled schedules",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedTask(sql, "bot:check-in:saved");
      yield* seedTask(sql, "bot-running", {
        threadId: "bot:task:saved:job:thread",
        status: "running",
      });
      yield* seedTask(sql, "bot-routine", { threadId: "bot:profile:saved:main" });
      const dispatched: string[] = [];
      yield* Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        yield* service.setEnabled({ id: ScheduledTaskId.make("bot-routine"), enabled: false });
        yield* service.setEnabled({ id: ScheduledTaskId.make("bot-routine"), enabled: true });
        const before = yield* sql`SELECT * FROM scheduled_tasks ORDER BY task_id`;
        for (const id of ["bot:check-in:saved", "bot-running", "bot-routine"]) {
          const failure = yield* service.runNow({ id: ScheduledTaskId.make(id) }).pipe(Effect.flip);
          assert.include(String(failure.cause), "removed Bots feature");
        }
        assert.deepEqual(dispatched, []);
        assert.deepEqual(yield* sql`SELECT * FROM scheduled_tasks ORDER BY task_id`, before);
        assert.equal((yield* service.list()).tasks.length, 3);
      }).pipe(Effect.provide(serviceLayer(dispatched)));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

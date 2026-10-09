import { assert, it } from "@effect/vitest";
import {
  BOT_MESSAGE_MAX_LENGTH,
  BOT_NAVIGATION_THREAD_LIMIT,
  BotId,
  botIdForThread,
  CommandId,
  EventId,
  MessageId,
  RunId,
  TurnItemId,
  BotError,
  BotProfile,
  BotTask,
  EnvironmentId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ExecutionEnvironmentDescriptor,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  type ScheduledTask,
  type ScheduledTaskMutationResult,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as TestClock from "effect/testing/TestClock";
import * as BotService from "./BotService.ts";
import * as BotStore from "./BotStore.ts";
import * as BotRuntime from "./BotRuntime.ts";
import * as BotRemote from "./BotRemote.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Launch from "../orchestration-v2/ThreadLaunchService.ts";
import { DispatchModeLimit } from "../orchestration-v2/DispatchModeLimit.ts";
import * as Projections from "../orchestration-v2/ProjectionStore.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as Folders from "../project/ManagedProjectFolders.ts";
import * as Schedules from "../scheduledTasks/ScheduledTaskService.ts";
import { BotToolkit } from "../mcp/toolkits/bots/tools.ts";

const environmentId = EnvironmentId.make("home");
const projectId = ProjectId.make("bot-workspace");
const selectedProject = ProjectId.make("selected");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const decodeContextCandidates = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const descriptor = Schema.decodeSync(ExecutionEnvironmentDescriptor)({
  environmentId,
  label: "Home",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "test",
  capabilities: { bots: true },
});
const profile = (name = "Assistant"): BotProfile => ({
  id: BotId.make(name),
  name,
  environmentId,
  projectId,
  threadId: ThreadId.make(`${name}:main`),
  modelSelection,
  permissions: {
    runtimeMode: "approval-required",
    allowDelegation: true,
    allowBotRequests: true,
    projects: [{ environmentId, projectId: selectedProject }],
  },
  paused: false,
  checkInMinutes: null,
  revision: 0,
  instructions: "Help when there is useful work.",
  memory: "Preserve this fact.",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
});
const task = (bot: BotProfile): BotTask => ({
  id: "task",
  botId: bot.id,
  environmentId,
  projectId: selectedProject,
  threadId: ThreadId.make("task:thread"),
  title: "Research",
  status: "pending",
  result: null,
  reported: false,
  createdAt: bot.createdAt,
});
const storeLayer = BotStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));
function serviceLayer(
  options: {
    threadLayer?: Layer.Layer<Threads.ThreadManagementService, never, never>;
    launch?: Launch.ThreadLaunchService["Service"]["launch"];
    sends?: Threads.ThreadManagementSendInput[];
    interrupts?: Threads.ThreadManagementInterruptInput[];
    delegatedStops?: ThreadId[];
    remoteSync?: BotRemote.BotRemote["Service"]["sync"];
    remoteLaunch?: BotRemote.BotRemote["Service"]["launch"];
    remoteConnect?: BotRemote.BotRemote["Service"]["connect"];
    commands?: OrchestrationV2ServerCommand[];
    scheduleUpserts?: ScheduledTaskUpsertInput[];
  } = {},
) {
  return BotService.layer.pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Launch.ThreadLaunchService)({
          launch: options.launch ?? (() => Effect.succeed({} as Launch.ThreadLaunchResult)),
        }),
        options.threadLayer ??
          Layer.mock(Threads.ThreadManagementService)({
            getThreadShell: () => Effect.succeed(null),
            dispatch: (command) =>
              Effect.sync(() => {
                options.commands?.push(command);
                return { sequence: 0, storedEvents: [] };
              }),
            interruptThread: (input) =>
              Effect.sync(() => {
                options.interrupts?.push(input);
                return {} as Threads.ThreadManagementInterruptResult;
              }),
            stopDelegatedTasks: (input) =>
              Effect.sync(() => {
                options.delegatedStops?.push(input.threadId);
              }),
            sendToThread: (input) =>
              Effect.sync(() => {
                options.sends?.push(input);
                return {} as Threads.ThreadManagementSendResult;
              }),
          }),
        Layer.mock(Folders.ManagedProjectFolders)({
          namedProjectsRoot: "/unused",
          ensureScratchProject: Effect.succeed({ projectId }),
        }),
        Layer.mock(Environment.ServerEnvironment)({ getDescriptor: Effect.succeed(descriptor) }),
        Layer.mock(Schedules.ScheduledTaskService)({
          list: () => Effect.succeed({ tasks: [] }),
          upsert: (input) =>
            Effect.sync(() => {
              options.scheduleUpserts?.push(input);
              return {} as ScheduledTaskMutationResult;
            }),
        }),
        Layer.mock(BotRemote.BotRemote)({
          ...(options.remoteSync === undefined ? {} : { sync: options.remoteSync }),
          ...(options.remoteLaunch === undefined ? {} : { launch: options.remoteLaunch }),
          ...(options.remoteConnect === undefined ? {} : { connect: options.remoteConnect }),
        }),
      ),
    ),
  );
}

it.effect("saves composer authority without replacing other bot permissions or context", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const scheduleUpserts: ScheduledTaskUpsertInput[] = [];
  const launches: Parameters<Launch.ThreadLaunchService["Service"]["launch"]>[0][] = [];
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = { ...profile(), checkInMinutes: 15 };
    yield* store.save(bot);
    yield* store.saveTask({ ...task(bot), status: "running" });
    const updated = yield* bots.update({
      botId: bot.id,
      expectedRevision: bot.revision,
      runtimeMode: "full-access",
    });
    assert.deepEqual(updated.permissions, { ...bot.permissions, runtimeMode: "full-access" });
    assert.equal(updated.memory, bot.memory);
    assert.equal(updated.instructions, bot.instructions);
    assert.equal((yield* store.get(bot.id)).permissions.runtimeMode, "full-access");
    assert.deepEqual(commands[0], {
      type: "thread.runtime-mode.set",
      commandId: CommandId.make(`${bot.id}:mode:1`),
      threadId: bot.threadId,
      runtimeMode: "full-access",
    });
    assert.equal((yield* store.task("task"))?.status, "cancelled");
    // Stop reaches background work a finished turn left running; the queue resumes after it.
    assert.deepEqual(
      commands.slice(1).map((command) => [command.type, "threadId" in command && command.threadId]),
      [
        ["thread.stop", bot.threadId],
        ["queue.resume", bot.threadId],
      ],
    );
    assert.equal(scheduleUpserts[0]?.runtimeMode, "full-access");
    yield* bots.startTask({
      botId: bot.id,
      clientRequestId: "new-authority-task",
      title: "New task",
      text: "Use the saved authority",
    });
    assert.equal(launches[0]?.runtimeMode, "full-access");
    assert.equal(
      (yield* bots
        .update({ botId: bot.id, expectedRevision: 0, runtimeMode: "approval-required" })
        .pipe(Effect.flip)).code,
      "conflict",
    );
    yield* bots.update({
      botId: bot.id,
      expectedRevision: updated.revision,
      runtimeMode: "approval-required",
    });
    assert.equal((yield* store.get(bot.id)).permissions.runtimeMode, "approval-required");
    assert.equal(scheduleUpserts.at(-1)?.runtimeMode, "approval-required");
  }).pipe(
    Effect.provide(
      serviceLayer({
        commands,
        scheduleUpserts,
        launch: (input) =>
          Effect.sync(() => {
            launches.push(input);
            return {} as Launch.ThreadLaunchResult;
          }),
      }),
    ),
  );
});

it("uses saved authority for main turns and caps task-specific authority", () => {
  const bot = profile();
  assert.equal(
    BotRuntime.botRuntimeMode(bot, { id: bot.threadId, runtimeMode: "full-access" }),
    "approval-required",
  );
  const elevated = {
    ...bot,
    permissions: { ...bot.permissions, runtimeMode: "full-access" as const },
  };
  assert.equal(
    BotRuntime.botRuntimeMode(elevated, { id: bot.threadId, runtimeMode: "approval-required" }),
    "full-access",
  );
  assert.equal(
    BotRuntime.botRuntimeMode(bot, { id: task(bot).threadId, runtimeMode: "full-access" }),
    "approval-required",
  );
  assert.equal(
    BotRuntime.botRuntimeMode(elevated, {
      id: task(bot).threadId,
      runtimeMode: "auto-accept-edits",
    }),
    "auto-accept-edits",
  );
});

it.effect("persists reduced remote authority before stopping the guest task", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const base = profile();
    const bot = {
      ...base,
      permissions: { ...base.permissions, runtimeMode: "full-access" as const },
    };
    const job = { ...task(bot), status: "running" as const };
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "2099-01-01T00:00:00.000Z" },
    });
    yield* bots.syncRemoteTask(
      {
        taskId: job.id,
        bot: { ...bot, permissions: base.permissions, revision: 1 },
        action: "sync",
      },
      "owner-session",
    );
    assert.equal((yield* store.task(job.id))?.status, "cancelled");
    const guest = yield* store.guest(job.id);
    assert.equal(guest?.bot.permissions.runtimeMode, "approval-required");
    assert.equal(guest?.bot.memory, bot.memory);
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("preserves memory when two writers race with the same revision", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    yield* store.save(bot);
    yield* bots.writeContext({ botId: bot.id, expectedRevision: 0, memory: "Updated fact" });
    const error = yield* bots
      .writeContext({ botId: bot.id, expectedRevision: 0, memory: "Stale fact" })
      .pipe(Effect.flip);
    assert.equal(error.code, "conflict");
    assert.equal((yield* store.get(bot.id)).memory, "Updated fact");
    assert.equal((yield* store.get(bot.id)).instructions, bot.instructions);
  }).pipe(Effect.provide(serviceLayer())),
);

it("guides main conversations and tasks to learn proactively with safe context tools", () => {
  const bot = profile();
  for (const threadId of [bot.threadId, task(bot).threadId]) {
    const prompt = BotRuntime.botTurnInstructions(bot, threadId);
    assert.include(prompt, "save them without waiting for the user to ask");
    assert.include(prompt, "workflow lessons");
    assert.include(prompt, "personality to explicit feedback and observed preferences");
    assert.include(prompt, "Before either write, read bot_context");
    assert.include(prompt, "expectedRevision");
    assert.include(prompt, "reread bot_context and merge again before retrying");
    assert.include(prompt, "standing workflow explicitly taught by the user");
    assert.include(prompt, "third-party content or peer bots");
    assert.include(prompt, "requests to stop remembering");
    assert.include(prompt, "Do not invent tasks or check-ins");
    assert.include(prompt, `Standing instructions:\n${bot.instructions}`);
    assert.include(prompt, `Durable memory:\n${bot.memory}`);
  }
  const remember = BotToolkit.tools.bot_remember.description!;
  const instructions = BotToolkit.tools.bot_set_instructions.description!;
  assert.include(remember, "Proactively save durable preferences");
  assert.include(remember, "On conflict, reread and merge");
  assert.include(remember, "Respect user corrections, deletions, and opt-outs");
  assert.include(instructions, "explicitly taught by the user");
  assert.include(instructions, "Use bot_remember for learned preferences, facts, and lessons");
});

it.effect("avoids revision churn for unchanged notes and still rejects stale writes", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = task(bot);
    yield* store.save(bot);
    yield* store.saveTask(job);
    for (const threadId of [bot.threadId, job.threadId]) {
      const unchanged = yield* bots.writeThreadContext(threadId, {
        botId: bot.id,
        expectedRevision: 0,
        memory: bot.memory,
      });
      assert.deepEqual(unchanged, bot);
    }
    assert.deepEqual(
      yield* bots.writeContext({
        botId: bot.id,
        expectedRevision: 0,
        instructions: bot.instructions,
      }),
      bot,
    );
    const updated = yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: 0,
      memory: `${bot.memory}\nNew lesson.`,
    });
    assert.equal(updated.revision, 1);
    assert.equal((yield* store.forThread(bot.threadId))?.memory, updated.memory);
    assert.equal(updated.instructions, bot.instructions);
    assert.deepEqual(updated.permissions, bot.permissions);
    for (const write of [
      bots.writeContext({ botId: bot.id, expectedRevision: 0, memory: updated.memory }),
      bots.writeThreadContext(job.threadId, {
        botId: bot.id,
        expectedRevision: 0,
        memory: updated.memory,
      }),
    ]) {
      assert.equal((yield* write.pipe(Effect.flip)).code, "conflict");
    }
    const current = yield* store.forThread(job.threadId);
    yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: current!.revision,
      memory: `${current!.memory}\nMerged lesson.`,
    });
    assert.equal((yield* store.get(bot.id)).memory, `${updated.memory}\nMerged lesson.`);
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("retains a remote baseline across writes, syncs, and revision-conflict retries", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = task(bot);
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner", expires: "2099-01-01T00:00:00.000Z" },
    });
    const unchanged = yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: 0,
      memory: bot.memory,
    });
    assert.equal(unchanged.revision, 0);
    assert.isUndefined((yield* store.task(job.id))?.contextUpdate);
    const learned = yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: 0,
      memory: `${bot.memory}\nRemote lesson.`,
    });
    yield* bots.syncRemoteTask(
      { taskId: job.id, bot: { ...bot, revision: 1, memory: "Home correction." }, action: "sync" },
      "owner",
    );
    assert.equal((yield* store.forThread(job.threadId))?.memory, learned.memory);
    assert.equal(
      (yield* bots
        .writeThreadContext(job.threadId, {
          botId: bot.id,
          expectedRevision: 0,
          instructions: "User-taught workflow.",
        })
        .pipe(Effect.flip)).code,
      "conflict",
    );
    const current = yield* store.forThread(job.threadId);
    yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: current!.revision,
      instructions: "User-taught workflow.",
    });
    assert.deepEqual((yield* store.task(job.id))?.contextUpdate, {
      baseRevision: 0,
      baseContext: { memory: bot.memory, instructions: bot.instructions },
      memory: learned.memory,
      instructions: "User-taught workflow.",
    });
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect.each(["memory", "instructions"] as const)(
  "queues only changed remote %s for merging after a home edit",
  (field) => {
    const sends: Threads.ThreadManagementSendInput[] = [];
    const bot = profile();
    const job = {
      ...task(bot),
      environmentId: EnvironmentId.make("remote"),
      status: "running" as const,
    };
    const contextUpdate = {
      baseRevision: 0,
      baseContext: { memory: bot.memory, instructions: bot.instructions },
      memory: bot.memory,
      instructions: bot.instructions,
      [field]: `New ${field}.`,
    };
    return Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const bots = yield* BotService.BotService;
      const edited = { ...bot, revision: 1, memory: "", instructions: "Only learn when I ask." };
      yield* store.save(edited);
      yield* store.saveTask(job);
      yield* bots.reconcile();
      yield* bots.reconcile();
      assert.deepEqual(yield* store.get(bot.id), edited);
      assert.isTrue((yield* store.task(job.id))?.reported);
      assert.equal(sends.length, 2);
      assert.equal(sends[0]?.threadId, bot.threadId);
      const prompt = sends[0]!.text;
      assert.include(prompt, "Read bot_context first");
      assert.include(prompt, "corrections, deletions, and opt-outs");
      assert.include(
        prompt,
        "bot_set_instructions only for standing roles or workflows explicitly taught",
      );
      const candidates = yield* decodeContextCandidates(prompt.split("\n\n").at(-1)!);
      assert.deepEqual(candidates, {
        baseRevision: 0,
        [field]: { before: bot[field], candidate: contextUpdate[field] },
      });
    }).pipe(
      Effect.provide(
        serviceLayer({
          sends,
          remoteSync: () => Effect.succeed({ ...job, status: "completed", contextUpdate }),
        }),
      ),
    );
  },
);

it.effect.each(["unchanged home", "already delivered", "reverted", "legacy conflict"] as const)(
  "reconciles remote notes with %s without repeated delivery",
  (scenario) => {
    const sends: Threads.ThreadManagementSendInput[] = [];
    const bot = profile();
    const job = {
      ...task(bot),
      environmentId: EnvironmentId.make("remote"),
      status: "running" as const,
    };
    const learned = `${bot.memory}\nRemote lesson.`;
    const current =
      scenario === "already delivered"
        ? { ...bot, revision: 1, memory: learned }
        : scenario === "unchanged home"
          ? bot
          : { ...bot, revision: 1, memory: "Home correction." };
    const contextUpdate = {
      baseRevision: 0,
      ...(scenario === "legacy conflict"
        ? {}
        : {
            baseContext: { memory: bot.memory, instructions: bot.instructions },
          }),
      memory: scenario === "reverted" ? bot.memory : learned,
      instructions: bot.instructions,
    };
    return Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const bots = yield* BotService.BotService;
      yield* store.save(current);
      yield* store.saveTask(job);
      yield* bots.reconcile();
      const saved = yield* store.get(bot.id);
      assert.equal(saved.memory, scenario === "unchanged home" ? learned : current.memory);
      assert.equal(saved.revision, scenario === "unchanged home" ? 1 : current.revision);
      assert.equal(saved.instructions, bot.instructions);
      assert.deepEqual(saved.permissions, bot.permissions);
      yield* bots.reconcile();
      assert.equal(sends.length, scenario === "legacy conflict" ? 2 : 1);
      if (scenario === "legacy conflict") {
        assert.include(sends[0]!.text, "If no baseline is available");
      }
      assert.isTrue((yield* store.task(job.id))?.reported);
    }).pipe(
      Effect.provide(
        serviceLayer({
          sends,
          remoteSync: () => Effect.succeed({ ...job, status: "completed", contextUpdate }),
        }),
      ),
    );
  },
);

it.effect(
  "returns lean navigation for local and remote tasks without guest or result content",
  () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const bots = yield* BotService.BotService;
      const bot = profile();
      yield* store.save(bot);
      yield* store.saveTask({
        ...task(bot),
        result: "Large private result",
        reported: true,
        status: "completed",
      });
      yield* store.saveTask({
        ...task(bot),
        id: "remote",
        environmentId: EnvironmentId.make("remote"),
        threadId: ThreadId.make("remote-thread"),
      });
      yield* store.saveTask(
        { ...task(profile("guest")), id: "guest", threadId: ThreadId.make("guest-thread") },
        {
          guest: {
            bot: profile("guest"),
            sessionId: "session",
            expires: "2099-01-01T00:00:00.000Z",
          },
        },
      );
      const navigation = yield* bots.navigation();
      assert.equal(navigation.bots[0]?.id, bot.id);
      assert.deepEqual(
        navigation.threads.map((thread) => thread.threadId),
        ["remote-thread", "task:thread"],
      );
      assert.isFalse(JSON.stringify(navigation).includes("Large private result"));
      assert.isFalse(JSON.stringify(navigation).includes(bot.memory));
    }).pipe(Effect.provide(serviceLayer())),
);

it.effect("does not launch work in an unselected project or for a paused bot", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    yield* store.save(bot);
    const input = {
      botId: bot.id,
      clientRequestId: "job",
      title: "Research",
      text: "Find an answer",
      projectId: ProjectId.make("private"),
    };
    assert.equal((yield* bots.startTask(input).pipe(Effect.flip)).code, "permission_denied");
    assert.equal((yield* store.tasks(bot.id)).length, 0);
    yield* store.save({ ...bot, paused: true, revision: 1 }, 0);
    assert.equal(
      (yield* bots.startTask({ ...input, projectId: selectedProject }).pipe(Effect.flip)).code,
      "paused",
    );
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("retries a persisted launch after failure and rejects changed retry content", () => {
  let attempts = 0;
  const layer = serviceLayer({
    launch: (input) =>
      Effect.suspend(() =>
        ++attempts === 1
          ? Effect.fail(
              new Launch.ThreadLaunchError({
                operation: "create-thread",
                commandId: input.commandId,
                projectId: input.projectId,
                cause: "temporary failure",
              }),
            )
          : Effect.succeed({} as Launch.ThreadLaunchResult),
      ),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    yield* store.save(bot);
    const input = {
      botId: bot.id,
      clientRequestId: "job",
      title: "Research",
      text: "Find an answer",
      projectId: selectedProject,
    };
    yield* bots.startTask(input).pipe(Effect.flip);
    assert.equal((yield* store.tasks(bot.id))[0]?.status, "pending");
    yield* bots.reconcile();
    assert.equal((yield* store.tasks(bot.id))[0]?.status, "running");
    yield* bots.startTask(input);
    assert.equal(attempts, 2);
    assert.equal(
      (yield* bots.startTask({ ...input, text: "A different job" }).pipe(Effect.flip)).code,
      "conflict",
    );
  }).pipe(Effect.provide(layer));
});

it.effect("retains a peer reply while its sender is paused, then delivers it once", () => {
  const sends: Threads.ThreadManagementSendInput[] = [];
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const sender = profile("Sender"),
      target = profile("Helper");
    yield* store.save(sender);
    yield* store.save(target);
    const { requestId } = yield* bots.request({
      botId: sender.id,
      targetBotId: target.id,
      clientRequestId: "ask",
      text: "Find a source",
    });
    yield* store.save({ ...sender, paused: true, revision: 1 }, 0);
    yield* bots.reply(target.id, requestId, "Found it");
    assert.equal(sends.length, 1);
    assert.equal((yield* store.pendingReplies(sender.id)).length, 1);
    yield* store.save({ ...sender, revision: 2 }, 1);
    yield* bots.reconcile();
    yield* bots.reconcile();
    assert.equal(sends.length, 2);
    assert.equal(sends[1]?.threadId, sender.threadId);
    assert.equal((yield* store.pendingReplies(sender.id)).length, 0);
    assert.equal(
      (yield* bots.reply(sender.id, requestId, "Spoofed reply").pipe(Effect.flip)).code,
      "permission_denied",
    );
  }).pipe(Effect.provide(serviceLayer({ sends })));
});

it.effect("prevents another paired session from reading or changing a guest task", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = task(bot);
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "2099-01-01T00:00:00.000Z" },
    });
    assert.equal(
      (yield* bots.remoteTaskState(job.id, "other-session").pipe(Effect.flip)).code,
      "permission_denied",
    );
    assert.equal(
      (yield* bots
        .syncRemoteTask({ taskId: job.id, bot, action: "cancel" }, "other-session")
        .pipe(Effect.flip)).code,
      "permission_denied",
    );
    assert.equal((yield* store.task(job.id))?.status, "pending");
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("releases a reported remote task's thread to its destination", () => {
  const actions: Array<string | undefined> = [];
  const bot = profile();
  const job = {
    ...task(bot),
    environmentId: EnvironmentId.make("remote"),
    status: "running" as const,
  };
  const remoteSync: BotRemote.BotRemote["Service"]["sync"] = (_bot, _task, action) =>
    Effect.sync(() => {
      actions.push(action);
      return { ...job, status: "completed", runId: RunId.make("first"), result: "Answer" };
    });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.reconcile();
    yield* bots.reconcile();
    assert.isTrue((yield* store.task(job.id))?.reported);
    assert.deepEqual(actions, [undefined, "release"]);
  }).pipe(Effect.provide(serviceLayer({ remoteSync })));
});

it.effect("keeps a remote task whose follow-up started before its release", () => {
  const actions: Array<string | undefined> = [];
  const bot = profile();
  const job = {
    ...task(bot),
    environmentId: EnvironmentId.make("remote"),
    status: "running" as const,
  };
  // The destination's thread starts a follow-up after the home server reads the first result.
  let destination: BotTask = { ...job, status: "completed", runId: RunId.make("first") };
  const remoteSync: BotRemote.BotRemote["Service"]["sync"] = (_bot, _task, action) =>
    Effect.sync(() => {
      actions.push(action);
      const read = destination;
      if (action === undefined && read.runId === "first")
        destination = { ...job, runId: RunId.make("second") };
      return read;
    });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.reconcile();
    assert.isFalse((yield* store.task(job.id))?.reported);
    destination = { ...job, status: "completed", runId: RunId.make("second"), result: "More" };
    yield* bots.reconcile();
    assert.isTrue((yield* store.task(job.id))?.reported);
    assert.isNotNull(yield* store.message("task:result:second"));
    assert.deepEqual(actions, [undefined, "release", undefined, "release"]);
  }).pipe(Effect.provide(serviceLayer({ remoteSync })));
});

it.effect("syncs a bot's remote tasks without waiting on one another", () => {
  const bot = profile();
  const jobs = ["first", "second"].map((id) => ({
    ...task(bot),
    id,
    environmentId: EnvironmentId.make(id),
    threadId: ThreadId.make(`${id}:thread`),
    status: "running" as const,
  }));
  return Effect.gen(function* () {
    // Each sync answers only once both have started, so one slow destination cannot hold up
    // another's lease renewal. Syncing one after another never finishes.
    const bothStarted = yield* Deferred.make<void>();
    let started = 0;
    const remoteSync: BotRemote.BotRemote["Service"]["sync"] = (_bot, job) =>
      Effect.gen(function* () {
        if (++started === jobs.length) yield* Deferred.succeed(bothStarted, undefined);
        yield* Deferred.await(bothStarted);
        return job.id === "first"
          ? yield* new BotError({ code: "unavailable" })
          : { ...job, progress: { id: "update", text: "Halfway" } };
      });
    yield* Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const bots = yield* BotService.BotService;
      yield* store.save(bot);
      for (const job of jobs) yield* store.saveTask(job);
      yield* bots.reconcile();
      assert.deepEqual((yield* store.task("second"))?.progress, {
        id: "update",
        text: "Halfway",
      });
    }).pipe(Effect.provide(serviceLayer({ remoteSync })));
  });
});

it.effect("retries a failed release before marking a remote task reported", () => {
  const actions: Array<string | undefined> = [];
  let releaseFails = true;
  const bot = profile();
  const job = {
    ...task(bot),
    environmentId: EnvironmentId.make("remote"),
    status: "running" as const,
  };
  const remoteSync: BotRemote.BotRemote["Service"]["sync"] = (_bot, _task, action) =>
    Effect.gen(function* () {
      actions.push(action);
      if (action === "release" && releaseFails) return yield* new BotError({ code: "unavailable" });
      return { ...job, status: "completed" as const, result: "Answer" };
    });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.reconcile();
    assert.isFalse((yield* store.task(job.id))?.reported);
    releaseFails = false;
    yield* bots.reconcile();
    assert.isTrue((yield* store.task(job.id))?.reported);
    assert.deepEqual(actions, [undefined, "release", undefined, "release"]);
  }).pipe(Effect.provide(serviceLayer({ remoteSync })));
});

it.effect("reports a remote task whose retried launch returns a released receipt", () => {
  let launches = 0;
  const bot = profile();
  const remote = EnvironmentId.make("remote");
  const receipt = (job: BotTask): BotTask => ({
    ...job,
    status: "completed",
    result: "Answer",
    reported: true,
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save({
      ...bot,
      permissions: { ...bot.permissions, projects: [{ environmentId: remote, projectId }] },
    });
    // The first launch response is lost after the destination accepted the task.
    const input = { botId: bot.id, clientRequestId: "job", title: "Research", text: "Go" };
    yield* bots.startTask({ ...input, environmentId: remote, projectId }).pipe(Effect.flip);
    yield* bots.reconcile();
    const [saved] = yield* store.activeTasks(bot.id);
    assert.include(saved, { status: "running", reported: false });
    yield* bots.reconcile();
    assert.include(yield* store.task(saved!.id), { status: "completed", reported: true });
    assert.equal(launches, 2);
  }).pipe(
    Effect.provide(
      serviceLayer({
        remoteLaunch: (_bot, job) =>
          ++launches === 1
            ? Effect.fail(new BotError({ code: "unavailable" }))
            : Effect.succeed(receipt(job)),
        remoteSync: (_bot, job) => Effect.succeed(receipt(job)),
      }),
    ),
  );
});

it.effect("answers a retried guest launch with its released receipt", () => {
  let laterRun = false;
  const bot = profile();
  const job = task(bot);
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        laterRun && id === job.threadId
          ? ({
              id,
              latestRunId: RunId.make("ordinary"),
              status: "running",
              pendingRuntimeRequest: null,
            } as unknown as OrchestrationV2ThreadShell)
          : null,
      ),
  });
  return Effect.gen(function* () {
    const bots = yield* BotService.BotService;
    const input = { bot, task: job, text: "Find an answer", modelSelection };
    yield* bots.acceptRemoteTask(input, "owner-session");
    yield* bots.syncRemoteTask({ taskId: job.id, bot, action: "cancel" }, "owner-session");
    // The released thread later runs as an ordinary destination thread.
    laterRun = true;
    assert.include(yield* bots.acceptRemoteTask(input, "owner-session"), {
      status: "cancelled",
      reported: true,
    });
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("retries releasing a cancelled guest whose release failed", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = { ...task(bot), status: "running" as const };
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "2099-01-01T00:00:00.000Z" },
    });
    yield* sql`CREATE TRIGGER fail_release BEFORE UPDATE OF thread_id ON bot_tasks
      BEGIN SELECT RAISE(ABORT, 'release failed'); END`;
    const cancel = bots.syncRemoteTask({ taskId: job.id, bot, action: "cancel" }, "owner-session");
    yield* cancel.pipe(Effect.flip);
    yield* sql`DROP TRIGGER fail_release`;
    yield* cancel;
    assert.isNull(yield* store.forThread(job.threadId));
    assert.include(yield* store.task(job.id), { status: "cancelled", reported: true });
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("cancels remote tasks before a new grant replaces their session", () => {
  const actions: Array<string | undefined> = [];
  const bot = profile();
  const remote = EnvironmentId.make("remote");
  const job = { ...task(bot), environmentId: remote, status: "running" as const };
  const connection = { environmentId: remote, label: "Remote", baseUrl: "https://remote.test" };
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.connect({
      botId: bot.id,
      environmentId: remote,
      baseUrl: connection.baseUrl,
      credential: "new-grant",
    });
    assert.deepEqual(actions, ["cancel", "connect"]);
    assert.include(yield* store.task(job.id), { status: "cancelled", reported: true });
  }).pipe(
    Effect.provide(
      serviceLayer({
        remoteSync: (_bot, _task, action) =>
          Effect.sync(() => {
            actions.push(action);
            return job;
          }),
        remoteConnect: () =>
          Effect.sync(() => {
            actions.push("connect");
            return connection;
          }),
      }),
    ),
  );
});

it.effect("keeps a long main-conversation message in the transcript", () => {
  const bot = profile();
  const runId = RunId.make("long-run");
  const messageId = MessageId.make("long-message");
  const records = {
    runs: [{ id: runId, status: "running", userMessageId: messageId }],
    messages: [
      {
        id: messageId,
        runId,
        role: "user",
        createdBy: "user",
        text: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
        createdAt: DateTime.makeUnsafe(0),
      },
    ],
    turnItems: [],
  };
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: () => Effect.succeed(null),
    getThreadRecords: () => Effect.succeed(records as never),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* bots.notifyThread(bot.threadId, runId);
    assert.lengthOf((yield* store.message(messageId))?.text ?? "", BOT_MESSAGE_MAX_LENGTH);
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("leaves a released guest thread as an ordinary thread", () => {
  const interrupts: Threads.ThreadManagementInterruptInput[] = [];
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = { ...task(bot), status: "completed" as const };
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "1970-01-01T00:01:00.000Z" },
    });
    yield* bots.syncRemoteTask({ taskId: job.id, bot, action: "release" }, "owner-session");
    assert.isNull(yield* store.forThread(job.threadId));
    // A home server that lost the response retries against the receipt.
    for (const action of ["sync", "cancel", "release"] as const)
      assert.isTrue(
        (yield* bots.syncRemoteTask({ taskId: job.id, bot, action }, "owner-session")).reported,
      );
    yield* TestClock.adjust("2 minutes");
    yield* bots.reconcile();
    assert.deepEqual(interrupts, []);
    assert.isNull(yield* store.forThread(job.threadId));
  }).pipe(Effect.provide(serviceLayer({ interrupts })));
});

it.effect("releases a cancelled guest thread and answers later requests with its receipt", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = { ...task(bot), status: "running" as const };
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "2099-01-01T00:00:00.000Z" },
    });
    yield* bots.syncRemoteTask({ taskId: job.id, bot, action: "cancel" }, "owner-session");
    assert.isNull(yield* store.forThread(job.threadId));
    for (const action of ["sync", "cancel", "release"] as const)
      assert.include(yield* bots.syncRemoteTask({ taskId: job.id, bot, action }, "owner-session"), {
        status: "cancelled",
        reported: true,
      });
    assert.isNull(yield* store.forThread(job.threadId));
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("keeps a guest whose follow-up is running when its release arrives", () => {
  const bot = profile();
  const job = { ...task(bot), status: "running" as const };
  const runId = RunId.make("second");
  const shell = { status: "running" };
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === job.threadId
          ? ({
              id,
              latestRunId: runId,
              status: shell.status,
              pendingRuntimeRequest: null,
            } as unknown as OrchestrationV2ThreadShell)
          : null,
      ),
    getThreadRecords: () =>
      Effect.succeed({
        runs: [{ id: runId, status: "completed" }],
        turnItems: [{ type: "assistant_message", runId, text: "More" }],
      } as never),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.saveTask(job, {
      guest: { bot, sessionId: "owner-session", expires: "2099-01-01T00:00:00.000Z" },
    });
    const release = bots.syncRemoteTask(
      { taskId: job.id, bot, action: "release" },
      "owner-session",
    );
    assert.include(yield* release, { status: "running", reported: false });
    assert.isNotNull(yield* store.forThread(job.threadId));
    shell.status = "completed";
    assert.include(yield* release, { status: "completed", reported: true, runId });
    assert.isNull(yield* store.forThread(job.threadId));
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("keeps a guest working while its finished turn has background work", () => {
  const bot = profile();
  const job = { ...task(bot), status: "running" as const };
  const runId = RunId.make("run");
  const shell = { pendingBackgroundTasks: [{}] };
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === job.threadId
          ? ({
              id,
              latestRunId: runId,
              status: "completed",
              pendingRuntimeRequest: null,
              pendingBackgroundTasks: shell.pendingBackgroundTasks,
            } as unknown as OrchestrationV2ThreadShell)
          : null,
      ),
    getThreadRecords: () =>
      Effect.succeed({
        runs: [{ id: runId, status: "completed" }],
        turnItems: [{ type: "assistant_message", runId, text: "Done" }],
      } as never),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.saveTask(job, {
      guest: { bot, sessionId: "owner-session", expires: "2099-01-01T00:00:00.000Z" },
    });
    // The home server releases a guest once it reads a finished state, so it must not see one.
    assert.equal((yield* bots.remoteTaskState(job.id, "owner-session")).status, "running");
    shell.pendingBackgroundTasks = [];
    assert.include(yield* bots.remoteTaskState(job.id, "owner-session"), {
      status: "completed",
      result: "Done",
    });
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("expires remote authority and returns guest memory to its owner", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = task(bot);
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "1970-01-01T00:01:00.000Z" },
    });
    assert.isFalse((yield* store.forThread(job.threadId))?.paused);
    yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: 0,
      memory: "A fact learned remotely",
    });
    assert.equal((yield* store.task(job.id))?.contextUpdate?.baseRevision, 0);
    assert.equal((yield* store.task(job.id))?.contextUpdate?.memory, "A fact learned remotely");
    yield* TestClock.adjust("2 minutes");
    assert.isTrue((yield* store.forThread(job.threadId))?.paused);
    yield* bots.reconcile();
    assert.equal((yield* store.task(job.id))?.status, "cancelled");
    assert.isNull(yield* store.forThread(job.threadId));
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("keeps a finished guest's result for its owner when the lease expires", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const bot = profile();
  const job = task(bot);
  const runId = RunId.make("run");
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === job.threadId
          ? ({
              id,
              latestRunId: runId,
              status: "completed",
              pendingRuntimeRequest: null,
            } as unknown as OrchestrationV2ThreadShell)
          : null,
      ),
    getThreadRecords: () =>
      Effect.succeed({
        runs: [{ id: runId, status: "completed" }],
        turnItems: [{ type: "assistant_message", runId, text: "The answer" }],
      } as never),
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: 0, storedEvents: [] };
      }),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.saveTask(job, {
      guest: { bot: bot, sessionId: "owner-session", expires: "1970-01-01T00:01:00.000Z" },
    });
    yield* TestClock.adjust("2 minutes");
    yield* bots.reconcile();
    assert.deepEqual(commands, []);
    const receipt = yield* bots.syncRemoteTask(
      { taskId: job.id, bot, action: "sync" },
      "owner-session",
    );
    assert.include(receipt, { status: "completed", result: "The answer", reported: true });
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("keeps a guest's saved notes when its launch is retried", () => {
  let launches = 0;
  const layer = serviceLayer({
    launch: (input) =>
      Effect.suspend(() =>
        ++launches === 1
          ? Effect.fail(
              new Launch.ThreadLaunchError({
                operation: "create-thread",
                commandId: input.commandId,
                projectId: input.projectId,
                cause: "temporary failure",
              }),
            )
          : Effect.succeed({} as Launch.ThreadLaunchResult),
      ),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    const job = task(bot);
    const input = { bot, task: job, text: "Find an answer", modelSelection };
    yield* bots.acceptRemoteTask(input, "owner-session").pipe(Effect.flip);
    yield* bots.writeThreadContext(job.threadId, {
      botId: bot.id,
      expectedRevision: 0,
      memory: "A fact learned remotely",
    });
    yield* bots.acceptRemoteTask(input, "owner-session");
    yield* bots.acceptRemoteTask(input, "owner-session");
    assert.equal(launches, 2);
    const saved = yield* store.task(job.id);
    assert.equal(saved?.status, "running");
    assert.equal(saved?.contextUpdate?.memory, "A fact learned remotely");
    assert.equal((yield* store.guest(job.id))?.bot.memory, "A fact learned remotely");
  }).pipe(Effect.provide(layer));
});

it.effect(
  "inherits permissions through delegated tasks and leaves ordinary threads unrestricted",
  () => {
    const bot = { ...profile(), permissions: { ...profile().permissions, allowDelegation: false } };
    const child = ThreadId.make("child");
    const projectionLayer = Layer.mock(Projections.ProjectionStoreV2)({
      getThreadShell: (id) =>
        Effect.succeed(
          id === child
            ? ({
                lineage: { parentThreadId: bot.threadId },
              } as OrchestrationV2ThreadShell)
            : null,
        ),
    });
    const layer = BotRuntime.layer.pipe(
      Layer.provideMerge(storeLayer),
      Layer.provide(projectionLayer),
    );
    return Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const runtime = yield* BotRuntime.BotRuntime;
      yield* store.save(bot);
      assert.equal((yield* runtime.forThread(child))?.id, bot.id);
      assert.equal(
        (yield* runtime.authorize(child, "delegate_task").pipe(Effect.flip)).code,
        "permission_denied",
      );
      assert.equal(
        (yield* runtime.authorize(child, "project", ProjectId.make("private")).pipe(Effect.flip))
          .code,
        "permission_denied",
      );
      yield* runtime.authorize(child, "project", selectedProject);
      yield* runtime.authorize(
        ThreadId.make("ordinary"),
        "delegate_task",
        ProjectId.make("private"),
      );
    }).pipe(Effect.provide(layer));
  },
);

it.effect("reaches only a bot's own threads in the shared Scratch project", () => {
  const bot = { ...profile(), permissions: { ...profile().permissions, projects: [] } };
  const layer = BotRuntime.layer.pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(
      Layer.mock(Projections.ProjectionStoreV2)({ getThreadShell: () => Effect.succeed(null) }),
    ),
  );
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const runtime = yield* BotRuntime.BotRuntime;
    yield* store.save(bot);
    yield* store.saveTask({ ...task(bot), projectId });
    yield* runtime.authorize(bot.threadId, "thread", projectId, task(bot).threadId);
    yield* runtime.authorize(bot.threadId, "thread-list", projectId);
    for (const denied of [
      runtime.authorize(bot.threadId, "project", projectId),
      runtime.authorize(bot.threadId, "thread", projectId, ThreadId.make("ordinary")),
    ])
      assert.equal((yield* Effect.flip(denied)).code, "permission_denied");
  }).pipe(Effect.provide(layer));
});

it.effect("keeps bot work out of threads its lifecycle cannot stop", () => {
  const bot = profile();
  const layer = BotRuntime.layer.pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(
      Layer.mock(Projections.ProjectionStoreV2)({ getThreadShell: () => Effect.succeed(null) }),
    ),
  );
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const runtime = yield* BotRuntime.BotRuntime;
    yield* store.save(bot);
    yield* runtime.authorize(bot.threadId, "delegate_task");
    for (const tool of ["create_threads", "t3_thread_launch", "t3_thread_fork"])
      assert.equal(
        (yield* runtime.authorize(bot.threadId, tool).pipe(Effect.flip)).code,
        "permission_denied",
      );
  }).pipe(Effect.provide(layer));
});

it.effect(
  "keeps bot routines on its own threads at home and remote tasks away from home tools",
  () => {
    const bot = profile();
    const local = task(bot);
    const remote = {
      ...task(bot),
      id: "remote",
      environmentId: EnvironmentId.make("remote"),
      threadId: ThreadId.make("remote:thread"),
    };
    const layer = BotRuntime.layer.pipe(
      Layer.provideMerge(storeLayer),
      Layer.provide(
        Layer.mock(Projections.ProjectionStoreV2)({ getThreadShell: () => Effect.succeed(null) }),
      ),
    );
    return Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const runtime = yield* BotRuntime.BotRuntime;
      yield* store.save(bot);
      yield* store.saveTask(local);
      yield* store.saveTask(remote);
      yield* runtime.authorize(bot.threadId, "schedule", projectId, bot.threadId);
      yield* runtime.authorize(local.threadId, "schedule", selectedProject, local.threadId);
      for (const target of [undefined, ThreadId.make("ordinary")])
        assert.equal(
          (yield* runtime.authorize(bot.threadId, "schedule", projectId, target).pipe(Effect.flip))
            .code,
          "permission_denied",
        );
      assert.equal(
        (yield* runtime
          .authorize(remote.threadId, "schedule", selectedProject, remote.threadId)
          .pipe(Effect.flip)).code,
        "permission_denied",
      );
      assert.isFalse(yield* runtime.isRemoteTask(bot.threadId));
      assert.isFalse(yield* runtime.isRemoteTask(local.threadId));
      assert.isTrue(yield* runtime.isRemoteTask(remote.threadId));
      assert.isFalse(yield* runtime.isRemoteTask(ThreadId.make("ordinary")));
    }).pipe(Effect.provide(layer));
  },
);

it("caps every provider mode at the bot's configured authority", () => {
  const modes = ["approval-required", "auto-accept-edits", "auto", "full-access"] as const;
  for (const [modeRank, mode] of modes.entries())
    for (const [ceilingRank, ceiling] of modes.entries())
      assert.equal(BotRuntime.cappedBotMode(mode, ceiling), modes[Math.min(modeRank, ceilingRank)]);
});

it.effect(
  "delivers committed conversation and task results once, only after their runs finish",
  () => {
    const sends: Threads.ThreadManagementSendInput[] = [];
    const projectionLayers = Layer.mergeAll(Projections.layer, RuntimeLayer.layerEventSink).pipe(
      Layer.provide(Sqlite.layerMemory),
    );
    const threadLayer = Layer.unwrap(
      Effect.gen(function* () {
        const projections = yield* Projections.ProjectionStoreV2;
        return Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: (id) => projections.getThreadShell(id).pipe(Effect.orDie),
          getThreadRecords: (id, fields, filter) =>
            projections.getThreadRecords(id, fields, filter).pipe(Effect.orDie),
          sendToThread: (input) =>
            Effect.sync(() => {
              sends.push(input);
              return {} as Threads.ThreadManagementSendResult;
            }),
        });
      }),
    ).pipe(Layer.provide(Projections.layer), Layer.provide(Sqlite.layerMemory), Layer.orDie);
    return Effect.gen(function* () {
      const bots = yield* BotService.BotService;
      const store = yield* BotStore.BotStore;
      const sink = yield* EventSink.EventSinkV2;
      const bot = profile();
      const job = { ...task(bot), status: "running" as const };
      yield* store.save(bot);
      yield* store.saveTask(job);
      yield* bots.sendMessage({ botId: bot.id, clientRequestId: "hello", text: "Hello" });
      const userMessageId = sends[0]!.messageId;
      const now = yield* DateTime.now;
      for (const [threadId, messageId, result] of [
        [bot.threadId, userMessageId, "Main answer"],
        [job.threadId, MessageId.make("task:message"), "Task answer"],
        [bot.threadId, MessageId.make("proactive:message"), "Proactive answer"],
        [bot.threadId, MessageId.make("native:message"), "Native composer answer"],
      ] as const) {
        const runId = RunId.make(`${messageId}:run`);
        const run = {
          id: runId,
          threadId,
          ordinal: result === "Native composer answer" ? 3 : result === "Proactive answer" ? 2 : 1,
          providerInstanceId: modelSelection.instanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: messageId,
          rootNodeId: null,
          activeAttemptId: null,
          status: "running" as const,
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        };
        yield* sink.write({
          events: [
            ...(result === "Proactive answer" || result === "Native composer answer"
              ? []
              : [
                  {
                    id: EventId.make(`${threadId}:create`),
                    threadId,
                    occurredAt: now,
                    type: "thread.created",
                    payload: {
                      id: threadId,
                      projectId: threadId === bot.threadId ? bot.projectId : job.projectId,
                      title: "Bot work",
                      modelSelection,
                      providerInstanceId: modelSelection.instanceId,
                      runtimeMode: "approval-required",
                      interactionMode: "default",
                      branch: null,
                      worktreePath: null,
                      activeProviderThreadId: null,
                      lineage: {
                        parentThreadId: null,
                        relationshipToParent: null,
                        rootThreadId: threadId,
                      },
                      forkedFrom: null,
                      createdBy: "user",
                      creationSource: "web",
                      createdAt: now,
                      updatedAt: now,
                      archivedAt: null,
                      deletedAt: null,
                      settledOverride: null,
                      settledAt: null,
                      lastVisitedAt: null,
                    },
                  } as const,
                ]),
            {
              id: EventId.make(`${messageId}:message`),
              threadId,
              occurredAt: now,
              type: "message.updated",
              payload: {
                id: messageId,
                threadId,
                runId,
                nodeId: null,
                role: "user",
                text: "Hello",
                attachments: [],
                streaming: false,
                createdAt: now,
                updatedAt: now,
                createdBy: result === "Proactive answer" ? "agent" : "user",
                creationSource: "web",
              },
            },
            {
              id: EventId.make(`${messageId}:running`),
              threadId,
              occurredAt: now,
              type: "run.updated",
              payload: run,
            },
            {
              id: EventId.make(`${messageId}:answer`),
              threadId,
              occurredAt: now,
              type: "turn-item.updated",
              payload: {
                id: TurnItemId.make(`${messageId}:answer`),
                threadId,
                runId,
                nodeId: null,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 1,
                status: "completed",
                title: null,
                startedAt: now,
                completedAt: now,
                updatedAt: now,
                type: "assistant_message",
                messageId: MessageId.make(`${messageId}:answer`),
                text: result,
                streaming: false,
              },
            },
          ],
        });
        yield* bots.reconcile();
        assert.isFalse(
          (yield* store.messages(bot.id)).some((message) => message.text.includes(result)),
        );
        yield* sink.write({
          events: [
            {
              id: EventId.make(`${messageId}:completed`),
              threadId,
              occurredAt: now,
              type: "run.updated",
              payload: { ...run, status: "completed", completedAt: now },
            },
          ],
        });
        yield* bots.notifyThread(threadId, runId);
        yield* bots.notifyThread(threadId, runId);
        yield* bots.reconcile();
        yield* bots.reconcile();
        assert.equal(
          (yield* store.messages(bot.id)).filter((message) => message.text.includes(result)).length,
          1,
        );
        if (threadId === bot.threadId) {
          assert.equal(
            (yield* store.messages(bot.id)).filter((message) => message.id === messageId).length,
            result === "Proactive answer" ? 0 : 1,
          );
        }
      }
      assert.equal((yield* store.task(job.id))?.status, "completed");
      assert.equal((yield* store.task(job.id))?.reported, true);
      assert.equal(sends.filter((input) => input.text.includes("Task answer")).length, 1);
    }).pipe(
      Effect.provide(serviceLayer({ threadLayer }).pipe(Layer.provideMerge(projectionLayers))),
    );
  },
);

const routineLayer = (sends: Threads.ThreadManagementSendInput[]) =>
  Schedules.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        BotRuntime.layer.pipe(Layer.provide(Projections.layer), Layer.provideMerge(storeLayer)),
        NodeCrypto.layer,
        Scheduler.layer,
        Layer.mock(Launch.ThreadLaunchService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(Threads.ThreadManagementService)({
          sendToThread: (input) =>
            Effect.sync(() => {
              sends.push(input);
              return {} as Threads.ThreadManagementSendResult;
            }),
        }),
      ),
    ),
    Layer.provide(Sqlite.layerMemory),
  );

it.effect("refuses a paused bot routine without queuing a run, then runs it after resume", () => {
  const sends: Threads.ThreadManagementSendInput[] = [];
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const schedules = yield* Schedules.ScheduledTaskService;
    const bot = { ...profile(), paused: true };
    yield* store.save(bot);
    const { task } = yield* schedules.upsert({
      title: "Routine",
      prompt: "Check commitments",
      enabled: true,
      schedule: { type: "interval", everyMs: 60000 },
      projectId: bot.projectId,
      threadId: bot.threadId,
      workspaceStrategy: { type: "root" },
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
    });
    const error = yield* schedules.runNow({ id: task.id }).pipe(Effect.flip);
    assert.include(JSON.stringify(error.cause), "Resume this bot");
    assert.equal(sends.length, 0);
    assert.equal((yield* schedules.list()).tasks[0]?.runCount, 0);
    yield* store.save({ ...bot, paused: false, revision: 1 }, 0);
    yield* schedules.runNow({ id: task.id });
    assert.equal(sends.length, 1);
    assert.equal((yield* schedules.list()).tasks[0]?.runCount, 1);
  }).pipe(Effect.provide(routineLayer(sends)));
});

it.effect("refuses a task-thread routine after its project access is removed", () => {
  const sends: Threads.ThreadManagementSendInput[] = [];
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const schedules = yield* Schedules.ScheduledTaskService;
    const bot = profile();
    const job = task(bot);
    yield* store.save(bot);
    yield* store.saveTask(job);
    const { task: routine } = yield* schedules.upsert({
      title: "Routine",
      prompt: "Check the project",
      enabled: true,
      schedule: { type: "interval", everyMs: 60000 },
      projectId: job.projectId,
      threadId: job.threadId,
      workspaceStrategy: { type: "root" },
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
    });
    yield* store.save(
      { ...bot, permissions: { ...bot.permissions, projects: [] }, revision: 1 },
      0,
    );
    const error = yield* schedules.runNow({ id: routine.id }).pipe(Effect.flip);
    assert.include(JSON.stringify(error.cause), "Give this bot access");
    assert.equal(sends.length, 0);
    yield* store.save({ ...bot, revision: 2 }, 1);
    yield* schedules.runNow({ id: routine.id });
    assert.equal(sends.length, 1);
  }).pipe(Effect.provide(routineLayer(sends)));
});

it.effect("keeps tasks running for profile edits and cancels them when access changes", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const delegatedStops: ThreadId[] = [];
  const mainStops = () =>
    commands.filter(
      (command) => command.type === "thread.stop" && command.threadId === "Assistant:main",
    );
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    const bot = profile();
    yield* store.save(bot);
    yield* store.saveTask({ ...task(bot), status: "running" });
    const edited = yield* bots.update({
      botId: bot.id,
      expectedRevision: bot.revision,
      name: "Renamed",
      permissions: bot.permissions,
    });
    assert.equal((yield* store.task("task"))?.status, "running");
    assert.lengthOf(mainStops(), 0);
    yield* bots.update({
      botId: bot.id,
      expectedRevision: edited.revision,
      permissions: { ...bot.permissions, projects: [] },
    });
    assert.equal((yield* store.task("task"))?.status, "cancelled");
    assert.lengthOf(mainStops(), 1);
    assert.deepEqual(delegatedStops, [bot.threadId]);
    const current = yield* store.get(bot.id);
    yield* bots.writeContext({
      botId: bot.id,
      expectedRevision: current.revision,
      memory: "",
      instructions: "",
    });
    assert.equal((yield* store.get(bot.id)).memory, "");
    assert.equal((yield* store.get(bot.id)).instructions, "");
  }).pipe(Effect.provide(serviceLayer({ commands, delegatedStops })));
});

it.effect("cancelling a task stops its queue and the tasks it delegated", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const delegatedStops: ThreadId[] = [];
  const bot = profile();
  const job = { ...task(bot), status: "running" as const };
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(id === job.threadId ? ({ id } as OrchestrationV2ThreadShell) : null),
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: 0, storedEvents: [] };
      }),
    stopDelegatedTasks: (input) =>
      Effect.sync(() => {
        delegatedStops.push(input.threadId);
      }),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.cancelTask(bot.id, job.id);
    assert.deepEqual(
      commands.map((command) => [command.type, "threadId" in command ? command.threadId : null]),
      [["thread.stop", job.threadId]],
    );
    assert.deepEqual(delegatedStops, [job.threadId]);
    assert.equal((yield* store.task(job.id))?.status, "cancelled");
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("stops a follow-up run after an earlier cancellation", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const bot = profile();
  const job = { ...task(bot), status: "running" as const };
  const thread = { runId: RunId.make("first") };
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === job.threadId
          ? ({ id, latestRunId: thread.runId } as OrchestrationV2ThreadShell)
          : null,
      ),
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: 0, storedEvents: [] };
      }),
    stopDelegatedTasks: () => Effect.void,
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.cancelTask(bot.id, job.id);
    thread.runId = RunId.make("follow-up");
    yield* store.saveTask({ ...job, runId: thread.runId });
    yield* bots.cancelTask(bot.id, job.id);
    const stops = commands.filter((command) => command.type === "thread.stop");
    assert.equal(stops.length, 2);
    assert.notEqual(stops[0]?.commandId, stops[1]?.commandId);
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect(
  "refuses tasks and routines above the calling thread's modes without leaving a retry",
  () => {
    let launches = 0;
    const scheduleUpserts: ScheduledTaskUpsertInput[] = [];
    return Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const bots = yield* BotService.BotService;
      const bot = profile();
      yield* store.save({
        ...bot,
        permissions: { ...bot.permissions, runtimeMode: "full-access" },
      });
      const narrow = Effect.provideService(DispatchModeLimit, {
        runtimeMode: "approval-required",
        interactionMode: "default",
      });
      const input = { botId: bot.id, clientRequestId: "narrow", title: "Research", text: "Go" };
      const refused = yield* bots.startTask(input).pipe(narrow, Effect.flip);
      assert.equal(refused.code, "permission_denied");
      yield* bots.reconcile();
      assert.equal((yield* store.tasks(bot.id)).length, 0);
      assert.equal(launches, 0);
      const routine = yield* bots
        .schedule({
          botId: bot.id,
          clientRequestId: "narrow",
          title: "Routine",
          prompt: "Deploy",
          enabled: true,
          schedule: { type: "interval", everyMs: 60000 },
        })
        .pipe(narrow, Effect.flip);
      assert.equal(routine.code, "permission_denied");
      assert.equal(scheduleUpserts.length, 0);
    }).pipe(
      Effect.provide(
        serviceLayer({
          scheduleUpserts,
          launch: () =>
            Effect.sync(() => {
              launches++;
              return {} as Launch.ThreadLaunchResult;
            }),
        }),
      ),
    );
  },
);

it.effect("reports follow-up runs in a task thread and stops them with the bot", () => {
  const sends: Threads.ThreadManagementSendInput[] = [];
  const commands: OrchestrationV2ServerCommand[] = [];
  const bot = profile();
  const job = task(bot);
  const thread = { runId: RunId.make("first"), status: "completed" as const, answer: "First" };
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === job.threadId
          ? ({
              id,
              latestRunId: thread.runId,
              status: thread.status,
              pendingRuntimeRequest: null,
            } as unknown as OrchestrationV2ThreadShell)
          : null,
      ),
    getThreadRecords: () =>
      Effect.succeed({
        runs: [{ id: thread.runId, status: thread.status }],
        turnItems: [{ type: "assistant_message", runId: thread.runId, text: thread.answer }],
      } as never),
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: 0, storedEvents: [] };
      }),
    interruptThread: () => Effect.succeed({} as Threads.ThreadManagementInterruptResult),
    stopDelegatedTasks: () => Effect.void,
    sendToThread: (input) =>
      Effect.sync(() => {
        sends.push(input);
        return {} as Threads.ThreadManagementSendResult;
      }),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask({ ...job, status: "running" });
    yield* bots.notifyThread(job.threadId, thread.runId);
    assert.isTrue((yield* store.task(job.id))?.reported);

    Object.assign(thread, { runId: RunId.make("follow-up"), status: "running" });
    yield* bots.notifyThread(job.threadId, thread.runId);
    assert.include(yield* store.task(job.id), { status: "running", reported: false });
    Object.assign(thread, { status: "completed", answer: "Follow-up" });
    yield* bots.notifyThread(job.threadId, thread.runId);
    yield* bots.notifyThread(job.threadId, thread.runId);
    assert.isTrue((yield* store.task(job.id))?.reported);
    assert.deepEqual(
      sends.map((input) => input.text.split("\n\n")[1]),
      ["First", "Follow-up"],
    );

    Object.assign(thread, { runId: RunId.make("second-follow-up"), status: "running" });
    yield* bots.notifyThread(job.threadId, thread.runId);
    yield* bots.update({ botId: bot.id, expectedRevision: bot.revision, paused: true });
    assert.isTrue(
      commands.some(
        (command) => command.type === "thread.stop" && command.threadId === job.threadId,
      ),
    );
    assert.include(yield* store.task(job.id), { status: "cancelled", reported: true });
    yield* bots.notifyThread(job.threadId, thread.runId);
    assert.isTrue((yield* store.task(job.id))?.reported);
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("recovers a follow-up result whose events were missed before a restart", () => {
  const sends: Threads.ThreadManagementSendInput[] = [];
  const bot = profile();
  const job = {
    ...task(bot),
    status: "completed" as const,
    reported: true,
    runId: RunId.make("first"),
  };
  const followUp = RunId.make("follow-up");
  const threadLayer = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        id === job.threadId
          ? ({
              id,
              latestRunId: followUp,
              status: "completed",
              pendingRuntimeRequest: null,
            } as unknown as OrchestrationV2ThreadShell)
          : null,
      ),
    getThreadRecords: () =>
      Effect.succeed({
        runs: [{ id: followUp, status: "completed" }],
        turnItems: [{ type: "assistant_message", runId: followUp, text: "Follow-up" }],
      } as never),
    sendToThread: (input) =>
      Effect.sync(() => {
        sends.push(input);
        return {} as Threads.ThreadManagementSendResult;
      }),
  });
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.reconcile();
    assert.lengthOf(sends, 0);

    yield* bots.recover();
    yield* bots.reconcile();
    assert.include(yield* store.task(job.id), { reported: true, runId: followUp });
    assert.deepEqual(
      sends.map((input) => input.text.split("\n\n")[1]),
      ["Follow-up"],
    );
  }).pipe(Effect.provide(serviceLayer({ threadLayer })));
});

it.effect("removes routines bound to a deleted bot's task threads", () => {
  const deleted: string[] = [];
  const bot = profile();
  const job = task(bot);
  const routine = (id: string, threadId: ThreadId | null) =>
    ({ id, threadId }) as unknown as ScheduledTask;
  const layer = BotService.layer.pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Launch.ThreadLaunchService)({}),
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(null),
          dispatch: () => Effect.succeed({ sequence: 0, storedEvents: [] }),
          stopDelegatedTasks: () => Effect.void,
        }),
        Layer.mock(Folders.ManagedProjectFolders)({ namedProjectsRoot: "/unused" }),
        Layer.mock(Environment.ServerEnvironment)({ getDescriptor: Effect.succeed(descriptor) }),
        Layer.mock(Schedules.ScheduledTaskService)({
          list: () =>
            Effect.succeed({
              tasks: [
                routine("main", bot.threadId),
                routine("task", job.threadId),
                routine("ordinary", ThreadId.make("ordinary")),
                routine("unbound", null),
              ],
            }),
          delete: (input) =>
            Effect.sync(() => {
              deleted.push(input.id);
              return { id: input.id } as never;
            }),
        }),
        Layer.mock(BotRemote.BotRemote)({}),
      ),
    ),
  );
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask({ ...job, status: "completed", reported: true });
    yield* bots.remove(bot.id, bot.revision);
    assert.deepEqual(deleted, ["main", "task"]);
  }).pipe(Effect.provide(layer));
});

it.effect("shows remote task progress in the main conversation transcript", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const bot = profile();
  const job = {
    ...task(bot),
    environmentId: EnvironmentId.make("remote"),
    status: "running" as const,
  };
  const progress = { id: "remote-progress", text: "Remote task is halfway done." };
  return Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bots = yield* BotService.BotService;
    yield* store.save(bot);
    yield* store.saveTask(job);
    yield* bots.reconcile();
    yield* bots.reconcile();
    assert.deepEqual(
      commands.filter((command) => command.type === "thread.bot-update.record"),
      [
        {
          type: "thread.bot-update.record",
          commandId: CommandId.make(`${progress.id}:transcript`),
          threadId: bot.threadId,
          turnItemId: TurnItemId.make(progress.id),
          text: progress.text,
        },
      ],
    );
  }).pipe(
    Effect.provide(
      serviceLayer({ commands, remoteSync: () => Effect.succeed({ ...job, progress }) }),
    ),
  );
});

it.effect("names bot conversations so their owner can be read from the thread id", () =>
  Effect.gen(function* () {
    const bots = yield* BotService.BotService;
    const bot = yield* bots.create({
      clientRequestId: "new:bot/1",
      name: "Assistant",
      modelSelection,
      permissions: profile().permissions,
    });
    const started = yield* bots.startTask({
      botId: bot.id,
      clientRequestId: "job:with/odd chars",
      title: "Research",
      text: "Find an answer",
      projectId: selectedProject,
    });
    assert.equal(botIdForThread(bot.threadId), bot.id);
    assert.equal(botIdForThread(started.threadId), bot.id);
    assert.equal(botIdForThread(ThreadId.make("ordinary-thread")), null);
  }).pipe(Effect.provide(serviceLayer())),
);

it.effect("lists each bot's recent and unfinished task threads for navigation", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const busy = profile("Busy");
    const quiet = profile("Quiet");
    yield* store.save(busy);
    yield* store.save(quiet);
    yield* store.saveTask({
      ...task(busy),
      id: "waiting",
      threadId: ThreadId.make("waiting:thread"),
      status: "running",
    });
    for (let index = 0; index < BOT_NAVIGATION_THREAD_LIMIT + 5; index++)
      yield* store.saveTask({
        ...task(busy),
        id: `busy-${index}`,
        threadId: ThreadId.make(`busy-${index}:thread`),
        status: "completed",
        reported: true,
      });
    yield* store.saveTask({ ...task(quiet), id: "quiet", threadId: ThreadId.make("quiet:thread") });

    const threads = yield* store.navigationThreads();
    const busyThreads = threads.filter((thread) => thread.botId === busy.id);
    assert.equal(busyThreads.length, BOT_NAVIGATION_THREAD_LIMIT + 1);
    assert.equal(busyThreads[0]?.threadId, `busy-${BOT_NAVIGATION_THREAD_LIMIT + 4}:thread`);
    assert.equal(busyThreads.at(-1)?.threadId, "waiting:thread");
    assert.deepEqual(
      threads.filter((thread) => thread.botId === quiet.id).map((thread) => thread.threadId),
      ["quiet:thread"],
    );
  }).pipe(Effect.provide(storeLayer)),
);

it.effect("keeps an older unfinished task in the bot's task list", () =>
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const bot = profile();
    yield* store.save(bot);
    yield* store.saveTask({ ...task(bot), id: "waiting", status: "running" });
    for (let index = 0; index < 100; index++)
      yield* store.saveTask({
        ...task(bot),
        id: `done-${index}`,
        threadId: ThreadId.make(`done-${index}:thread`),
        status: "completed",
        reported: true,
      });
    const tasks = yield* store.tasks(bot.id);
    assert.lengthOf(tasks, 101);
    assert.equal(tasks.at(-1)?.id, "waiting");
  }).pipe(Effect.provide(storeLayer)),
);

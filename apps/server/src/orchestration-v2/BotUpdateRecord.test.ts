import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Runs here never reach a provider"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
// No effect worker: bot updates must not queue a provider turn.
const layerTest = ThreadManagementService.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
      ProviderReplayHarness.layerWithRegistry(
        { name: "bot-update" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: layerDatabase, runEffectWorker: false },
      ),
    ),
  ),
);

it.effect("records a bot update in the existing transcript once without starting a run", () =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("bot:main");
    yield* threads.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create"),
      threadId,
      projectId: ProjectId.make("project:bot-update"),
      title: "Assistant",
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const command = {
      type: "thread.bot-update.record" as const,
      commandId: CommandId.make("update"),
      threadId,
      turnItemId: TurnItemId.make("update-item"),
      text: "The research task is ready for your review.",
    };
    yield* threads.dispatch(command);
    yield* threads.dispatch(command);
    const projection = yield* orchestrator.getThreadProjection(threadId);
    assert.equal(projection.runs.length, 0);
    assert.equal(projection.turnItems.length, 1);
    const item = projection.turnItems[0];
    assert.equal(item?.type, "assistant_message");
    if (item?.type !== "assistant_message") throw new Error("Missing bot update");
    assert.equal(item.text, command.text);
    assert.equal(item.messageId, MessageId.make(command.turnItemId));
    assert.equal(item.runId, null);
    assert.equal(item.streaming, false);
    yield* threads.dispatch({ ...command, commandId: CommandId.make("retry-new-key") });
    assert.equal((yield* orchestrator.getThreadProjection(threadId)).turnItems.length, 1);
    yield* threads
      .dispatch({ ...command, commandId: CommandId.make("conflicting"), text: "Changed" })
      .pipe(Effect.flip);
    assert.equal((yield* orchestrator.getThreadProjection(threadId)).turnItems.length, 1);

    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("message"),
      threadId,
      messageId: MessageId.make("message"),
      dispatchMode: { type: "defer_start" },
      text: "Check on my tasks",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    });
    const before = yield* orchestrator.getThreadProjection(threadId);
    yield* threads.dispatch({
      ...command,
      commandId: CommandId.make("update-after-message"),
      turnItemId: TurnItemId.make("update-after-message"),
    });
    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.equal(after.runs.length, before.runs.length);
    const newUpdate = after.turnItems.find((item) => item.id === "update-after-message")!;
    assert.equal(newUpdate.runId, null);
    assert.isAbove(newUpdate.ordinal, Math.max(...before.turnItems.map((item) => item.ordinal)));
  }).pipe(Effect.provide(layerTest)),
);

import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as CommandReceipts from "../persistence/OrchestrationCommandReceipts.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerStores = Layer.mergeAll(
  EventStore.layer,
  ProjectionStore.layer,
  CommandReceipts.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const layerTest = ProjectionMaintenance.layer.pipe(Layer.provideMerge(layerStores));

it.effect("replays retired bot updates and receipts without the removed command contract", () =>
  Effect.gen(function* () {
    const events = yield* EventStore.EventStoreV2;
    const receipts = yield* CommandReceipts.OrchestrationCommandReceiptRepository;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("bot:profile:retired:main");
    const commandId = CommandId.make("retired-bot-update");
    const instanceId = ProviderInstanceId.make("codex");
    const update: OrchestrationV2DomainEvent = {
      id: EventId.make("retired-bot-update"),
      type: "turn-item.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make("retired-bot-update"),
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 2_000_007,
        status: "completed",
        title: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "assistant_message",
        messageId: MessageId.make("retired-bot-update"),
        text: "The saved research is ready for your review.",
        streaming: false,
      },
    };
    yield* events.append({
      events: [
        {
          id: EventId.make("retired-bot-created"),
          type: "thread.created",
          threadId,
          occurredAt: now,
          payload: {
            id: threadId,
            projectId: ProjectId.make("scratch"),
            title: "Retained bot conversation",
            providerInstanceId: instanceId,
            modelSelection: { instanceId, model: "gpt-5.4" },
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdBy: "user",
            creationSource: "web",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        },
      ],
    });
    const [stored] = yield* events.append({ commandId, events: [update] });
    yield* receipts.upsert({
      commandId,
      aggregateKind: "thread",
      aggregateId: threadId,
      commandType: "thread.bot-update.record",
      acceptedAt: DateTime.formatIso(now),
      resultSequence: stored!.sequence,
      status: "accepted",
      error: null,
    });

    assert.deepStrictEqual(
      (yield* events.readByCommandId({ commandId }).pipe(Stream.runCollect)).map(
        (row) => row.event,
      ),
      [update],
    );
    assert.isTrue((yield* maintenance.rebuild).valid);
    const projection = yield* projections.getThreadProjection(threadId);
    assert.deepStrictEqual(projection.turnItems, [update.payload]);
    assert.equal(projection.runs.length, 0);
    assert.deepStrictEqual(
      yield* sql`SELECT ordinal FROM orchestration_v2_turn_item_positions WHERE thread_id = ${threadId}`,
      [{ ordinal: update.payload.ordinal }],
    );
    const receipt = yield* receipts.getByCommandId({ commandId });
    assert.equal(Option.getOrThrow(receipt).commandType, "thread.bot-update.record");
  }).pipe(Effect.provide(layerTest)),
);

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as Events from "../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as BotService from "./BotService.ts";

/** Replays unreported results after a restart, including work on remote servers. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bots = yield* BotService.BotService;
    const events = yield* Events.OrchestrationEventStore;
    const afterSequence = yield* events.latestApplicationSequence;
    yield* forkParked(
      events
        .streamProjectedApplicationEvents({
          afterSequence,
          project: (event) => ({
            sequence: event.sequence,
            type: "event" in event ? event.event.type : event.type,
            threadId: "event" in event ? event.event.threadId : null,
            runId:
              "event" in event && event.event.type === "run.updated"
                ? event.event.payload.id
                : undefined,
          }),
        })
        .pipe(
          Stream.filter(
            (event) => event.type === "run.updated" || event.type === "runtime-request.updated",
          ),
          Stream.runForEach((event) =>
            (event.threadId === null
              ? Effect.void
              : bots.notifyThread(event.threadId, event.runId)
            ).pipe(
              Effect.catchTags({
                BotError: (error) =>
                  Effect.logWarning("Bot event delivery failed", { code: error.code }),
              }),
            ),
          ),
        ),
    );
    yield* forkParked(
      // Follow-up runs before afterSequence are found here; later ones arrive as events above.
      bots.recover().pipe(
        Effect.catchTags({
          BotError: (error) =>
            Effect.logWarning("Bot follow-up recovery failed", { code: error.code }),
        }),
        Effect.andThen(
          bots.reconcile().pipe(
            Effect.catchTags({
              BotError: (error) =>
                Effect.logWarning("Bot result delivery failed", { code: error.code }),
            }),
            Effect.repeat(Schedule.spaced("30 seconds")),
          ),
        ),
      ),
    );
  }),
);

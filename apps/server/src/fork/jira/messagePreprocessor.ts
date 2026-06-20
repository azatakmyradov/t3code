/**
 * Fork seam for Jira message preprocessing in the provider command reactor.
 *
 * Owns the whole "a turn is starting — does the user message reference Jira
 * tickets?" flow: build the agent context (rewriting the provider message),
 * unlock the Jira MCP tools for the thread, and append the resulting
 * `jira.context.*` activities. Upstream `ProviderCommandReactor` collapses to a
 * single call site that returns the (possibly rewritten) message text.
 */
import type { CommandId, EventId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine.ts";
import * as JiraToolAccess from "../../mcp/JiraToolAccess.ts";
import {
  buildJiraAgentContextForMessage,
  type JiraAgentContextBuildResult,
} from "./JiraAgentContext.ts";

export interface ForkJiraMessagePreprocessorDeps<CmdE, CmdR, EvtE, EvtR> {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly serverCommandId: (tag: string) => Effect.Effect<CommandId, CmdE, CmdR>;
  readonly serverEventId: () => Effect.Effect<EventId, EvtE, EvtR>;
}

/**
 * Bind the Jira message preprocessor to the reactor's orchestration engine and
 * id generators. Returns a function that builds Jira context for a starting
 * turn and returns the full build result (its `providerMessageText` is the
 * message that should be sent to the provider).
 */
export const makeForkJiraMessagePreprocessor = <CmdE, CmdR, EvtE, EvtR>(
  deps: ForkJiraMessagePreprocessorDeps<CmdE, CmdR, EvtE, EvtR>,
) => {
  const { orchestrationEngine, serverCommandId, serverEventId } = deps;

  const appendJiraContextActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: "jira.context.attached" | "jira.context.lookup_failed";
    readonly tone: "info" | "error";
    readonly summary: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("jira-context-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const appendJiraContextActivities = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly result: JiraAgentContextBuildResult;
    readonly createdAt: string;
  }) {
    const payload = {
      keys: input.result.keys,
      failedKeys: input.result.failedKeys,
      omittedKeys: input.result.omittedKeys,
      fetchedAt: input.result.fetchedAt,
    };

    if (input.result.keys.length > 0) {
      yield* appendJiraContextActivity({
        threadId: input.threadId,
        kind: "jira.context.attached",
        tone: "info",
        summary: "Attached Jira context",
        payload,
        createdAt: input.createdAt,
      });
    }

    if (input.result.hasLookupFailure) {
      yield* appendJiraContextActivity({
        threadId: input.threadId,
        kind: "jira.context.lookup_failed",
        tone: input.result.keys.length === 0 ? "error" : "info",
        summary: input.result.keys.length === 0 ? "Jira lookup failed" : "Jira lookup incomplete",
        payload,
        createdAt: input.createdAt,
      });
    }
  });

  return (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      const jiraContext = yield* buildJiraAgentContextForMessage({
        messageText: input.messageText,
        fetchedAt: input.createdAt,
      });

      // Unlock the Jira MCP tools for this thread once a ticket has actually
      // been referenced, so the agent cannot reach for them out of context.
      if (jiraContext.keys.length > 0) {
        yield* Effect.sync(() => JiraToolAccess.markThreadJiraReferenced(input.threadId));
      }

      yield* appendJiraContextActivities({
        threadId: input.threadId,
        result: jiraContext,
        createdAt: input.createdAt,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to append Jira context activity", {
            threadId: input.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );

      return jiraContext;
    });
};

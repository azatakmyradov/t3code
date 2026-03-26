import {
  type AgentSession,
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  type CreateAgentSessionOptions,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import {
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Queue, Random, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter.ts";
import type { ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";

const PROVIDER = "pi" as const;
const PLAN_PREFIX = [
  "You are operating in plan mode.",
  "Do not implement changes.",
  "Respond with a single <proposed_plan>...</proposed_plan> block.",
].join("\n");

type PiTurnRecord = {
  id: TurnId;
  entryId?: string;
  items: unknown[];
};

type PiSessionContext = {
  threadId: ThreadId;
  session: AgentSession;
  sessionManager: SessionManager;
  sessionFile: string;
  cwd: string;
  agentDir: string | undefined;
  runtimeMode: "full-access";
  model: string;
  thinkingLevel: CreateAgentSessionOptions["thinkingLevel"] | undefined;
  unsubscribe: () => void;
  turns: PiTurnRecord[];
  activeTurnId: TurnId | undefined;
  assistantItemId: string | undefined;
  stopped: boolean;
};

type RuntimeBase = Pick<
  Extract<ProviderRuntimeEvent, { type: "session.started" }>,
  "eventId" | "provider" | "createdAt" | "threadId" | "providerRefs" | "raw"
>;

function nowIso(): string {
  return new Date().toISOString();
}

function unsupportedInteractiveError(method: string) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail:
      "Pi does not expose interactive approval or structured user-input requests through the SDK integration used by T3 Code.",
  });
}

function sessionNotFound(threadId: ThreadId) {
  return new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
}

function getModelSlug(model: { provider?: string; id?: string } | undefined): string | undefined {
  if (!model) return undefined;
  const provider = typeof model.provider === "string" ? model.provider : undefined;
  const id = typeof model.id === "string" ? model.id : undefined;
  return provider && id ? `${provider}/${id}` : undefined;
}

function textFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const text = (entry as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  });
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

function inferItemType(
  toolName: string,
): Extract<Extract<ProviderRuntimeEvent, { type: "item.started" }>["payload"]["itemType"], string> {
  switch (toolName) {
    case "bash":
      return "command_execution";
    case "edit":
    case "write":
      return "file_change";
    default:
      return "dynamic_tool_call";
  }
}

function sessionDirForThread(path: Path.Path, stateDir: string, threadId: ThreadId): string {
  return path.join(stateDir, "pi-sessions", threadId);
}

function buildResumeCursor(context: PiSessionContext) {
  return {
    sessionFile: context.sessionFile,
    ...(context.agentDir ? { agentDir: context.agentDir } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
  };
}

function buildThreadSnapshot(
  threadId: ThreadId,
  turns: ReadonlyArray<PiTurnRecord>,
): ProviderThreadSnapshot {
  return {
    threadId,
    turns: turns.map((turn) => ({ id: turn.id, items: turn.items })),
  };
}

function modelFromSelection(modelRegistry: ModelRegistry, selection: string | undefined) {
  if (!selection || selection === "auto") {
    return undefined;
  }
  const [provider, ...rest] = selection.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    return undefined;
  }
  return modelRegistry.find(provider, modelId);
}

async function buildPromptOptions(
  input: ProviderSendTurnInput,
  attachmentsDir: string,
  fileSystem: FileSystem.FileSystem,
): Promise<{ images?: Array<{ type: "image"; data: string; mimeType: string }> }> {
  if (!input.attachments || input.attachments.length === 0) {
    return {};
  }

  const images = await Promise.all(
    input.attachments.map(async (attachment) => {
      const attachmentPath = resolveAttachmentPath({ attachmentsDir, attachment });
      if (!attachmentPath) {
        throw new Error(`Attachment not found for Pi prompt: ${attachment.id}`);
      }
      const bytes = await Effect.runPromise(fileSystem.readFile(attachmentPath));
      return {
        type: "image" as const,
        data: Buffer.from(bytes).toString("base64"),
        mimeType: attachment.mimeType,
      };
    }),
  );

  return { images };
}

const makePiAdapter = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const eventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, PiSessionContext>();

  const offerEvent = <T extends ProviderRuntimeEvent>(event: T) =>
    Queue.offer(eventQueue, event).pipe(Effect.asVoid);

  const makeStamp = Effect.gen(function* () {
    const eventId = EventId.makeUnsafe(yield* Random.nextUUIDv4);
    return { eventId, createdAt: nowIso() };
  });

  const requireSession = (threadId: ThreadId) =>
    Effect.sync(() => sessions.get(threadId)).pipe(
      Effect.flatMap((session) =>
        session ? Effect.succeed(session) : Effect.fail(sessionNotFound(threadId)),
      ),
    );

  const createRuntimeBase = (
    context: PiSessionContext,
    event: AgentSessionEvent,
    stamp: { eventId: EventId; createdAt: string },
  ): RuntimeBase => ({
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.threadId,
    providerRefs: {},
    raw: {
      source: "pi.sdk.event",
      messageType: event.type,
      payload: event,
    },
  });

  const restartSessionWithModel = (
    context: PiSessionContext,
    nextModel: string,
    nextThinkingLevel: CreateAgentSessionOptions["thinkingLevel"] | undefined,
  ) =>
    Effect.gen(function* () {
      const authStorage = AuthStorage.create(context.agentDir);
      const modelRegistry = new ModelRegistry(
        authStorage,
        context.agentDir ? path.join(context.agentDir, "models.json") : undefined,
      );
      const resolvedModel =
        nextModel === "auto" ? undefined : modelFromSelection(modelRegistry, nextModel);
      if (nextModel !== "auto" && !resolvedModel) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Unknown or unavailable Pi model: ${nextModel}`,
        });
      }

      const restarted = yield* Effect.tryPromise({
        try: () =>
          createAgentSession({
            cwd: context.cwd,
            ...(context.agentDir ? { agentDir: context.agentDir } : {}),
            authStorage,
            modelRegistry,
            sessionManager: SessionManager.open(
              context.sessionFile,
              sessionDirForThread(path, serverConfig.stateDir, context.threadId),
            ),
            ...(resolvedModel ? { model: resolvedModel } : {}),
            ...(nextThinkingLevel ? { thinkingLevel: nextThinkingLevel } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: context.threadId,
            detail: cause instanceof Error ? cause.message : "Failed to restart Pi session",
            cause,
          }),
      });

      context.unsubscribe();
      context.session.dispose();
      context.session = restarted.session;
      context.sessionManager = restarted.session.sessionManager;
      context.sessionFile = restarted.session.sessionFile ?? context.sessionFile;
      context.model = nextModel;
      context.thinkingLevel = nextThinkingLevel;
      context.activeTurnId = undefined;
      context.assistantItemId = undefined;
      context.unsubscribe = attachListeners(context);
    });

  const attachListeners = (context: PiSessionContext) =>
    context.session.subscribe((event: AgentSessionEvent) => {
      void Effect.runPromise(
        Effect.ignore(
          Effect.gen(function* () {
            const stamp = yield* makeStamp;
            const base = createRuntimeBase(context, event, stamp);

            switch (event.type) {
              case "agent_start":
                yield* offerEvent({
                  ...base,
                  type: "session.state.changed",
                  payload: { state: "running" },
                } satisfies Extract<ProviderRuntimeEvent, { type: "session.state.changed" }>);
                break;
              case "turn_start":
                if (context.activeTurnId) {
                  yield* offerEvent({
                    ...base,
                    turnId: context.activeTurnId,
                    type: "turn.started",
                    payload: { model: context.model },
                  } satisfies Extract<ProviderRuntimeEvent, { type: "turn.started" }>);
                }
                break;
              case "message_start":
                if (
                  context.activeTurnId &&
                  (event.message as { role?: unknown }).role === "assistant"
                ) {
                  context.assistantItemId = `assistant:${stamp.eventId}`;
                }
                break;
              case "message_update":
                if (context.activeTurnId) {
                  yield* offerEvent({
                    ...base,
                    turnId: context.activeTurnId,
                    ...(context.assistantItemId
                      ? { itemId: RuntimeItemId.makeUnsafe(context.assistantItemId) }
                      : {}),
                    type: "content.delta",
                    payload: {
                      streamKind:
                        event.assistantMessageEvent.type === "thinking_delta"
                          ? "reasoning_text"
                          : "assistant_text",
                      delta: (event.assistantMessageEvent as { delta?: string }).delta ?? "",
                    },
                  } satisfies Extract<ProviderRuntimeEvent, { type: "content.delta" }>);
                }
                break;
              case "message_end":
                if (
                  context.activeTurnId &&
                  context.assistantItemId &&
                  (event.message as { role?: unknown }).role === "assistant"
                ) {
                  yield* offerEvent({
                    ...base,
                    turnId: context.activeTurnId,
                    itemId: RuntimeItemId.makeUnsafe(context.assistantItemId),
                    type: "item.completed",
                    payload: {
                      itemType: "assistant_message",
                      status: "completed",
                      detail: textFromMessage(event.message),
                    },
                  } satisfies Extract<ProviderRuntimeEvent, { type: "item.completed" }>);
                  context.assistantItemId = undefined;
                }
                break;
              case "tool_execution_start": {
                const turn = context.turns.at(-1);
                turn?.items.push({ toolName: event.toolName, args: event.args });
                yield* offerEvent({
                  ...base,
                  ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
                  itemId: RuntimeItemId.makeUnsafe(event.toolCallId),
                  type: "item.started",
                  payload: {
                    itemType: inferItemType(event.toolName),
                    title: event.toolName,
                    data: event.args,
                  },
                } satisfies Extract<ProviderRuntimeEvent, { type: "item.started" }>);
                break;
              }
              case "tool_execution_update":
                yield* offerEvent({
                  ...base,
                  ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
                  itemId: RuntimeItemId.makeUnsafe(event.toolCallId),
                  type: "tool.progress",
                  payload: {
                    toolUseId: event.toolCallId,
                    toolName: event.toolName,
                    summary:
                      typeof event.partialResult === "string"
                        ? event.partialResult
                        : JSON.stringify(event.partialResult),
                  },
                } satisfies Extract<ProviderRuntimeEvent, { type: "tool.progress" }>);
                break;
              case "tool_execution_end":
                yield* offerEvent({
                  ...base,
                  ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
                  itemId: RuntimeItemId.makeUnsafe(event.toolCallId),
                  type: "item.completed",
                  payload: {
                    itemType: inferItemType(event.toolName),
                    status: event.isError ? "failed" : "completed",
                    data: event.result,
                  },
                } satisfies Extract<ProviderRuntimeEvent, { type: "item.completed" }>);
                break;
              case "turn_end": {
                const turn = context.turns.findLast((entry) => entry.id === context.activeTurnId);
                const leafId = context.sessionManager.getLeafId() ?? undefined;
                if (turn && leafId) {
                  turn.entryId = leafId;
                  context.sessionManager.appendLabelChange(leafId, `t3-turn:${turn.id}`);
                }
                if (context.activeTurnId) {
                  yield* offerEvent({
                    ...base,
                    turnId: context.activeTurnId,
                    type: "turn.completed",
                    payload: { state: "completed" },
                  } satisfies Extract<ProviderRuntimeEvent, { type: "turn.completed" }>);
                }
                context.activeTurnId = undefined;
                context.assistantItemId = undefined;
                break;
              }
              case "auto_compaction_start":
                yield* offerEvent({
                  ...base,
                  itemId: RuntimeItemId.makeUnsafe(`compact:${stamp.eventId}`),
                  type: "item.started",
                  payload: { itemType: "context_compaction", title: "Context compaction" },
                } satisfies Extract<ProviderRuntimeEvent, { type: "item.started" }>);
                break;
              case "auto_compaction_end":
                yield* offerEvent({
                  ...base,
                  itemId: RuntimeItemId.makeUnsafe(`compact:${stamp.eventId}`),
                  type: "item.completed",
                  payload: {
                    itemType: "context_compaction",
                    status: event.aborted ? "failed" : "completed",
                  },
                } satisfies Extract<ProviderRuntimeEvent, { type: "item.completed" }>);
                break;
              case "auto_retry_start":
                yield* offerEvent({
                  ...base,
                  type: "runtime.warning",
                  payload: { message: event.errorMessage, detail: { attempt: event.attempt } },
                } satisfies Extract<ProviderRuntimeEvent, { type: "runtime.warning" }>);
                break;
              case "auto_retry_end":
                if (!event.success && event.finalError) {
                  yield* offerEvent({
                    ...base,
                    type: "runtime.error",
                    payload: { message: event.finalError, detail: { attempt: event.attempt } },
                  } satisfies Extract<ProviderRuntimeEvent, { type: "runtime.error" }>);
                }
                break;
              case "agent_end":
                context.assistantItemId = undefined;
                break;
            }
          }),
        ),
      );
    });

  const startSession: PiAdapterShape["startSession"] = (input) =>
    Effect.gen(function* () {
      if (input.runtimeMode === "approval-required") {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/start",
          detail:
            "Pi does not support approval-required runtime mode because it has no permission popups.",
        });
      }

      const cwd = input.cwd ?? serverConfig.cwd;
      const sessionDir = sessionDirForThread(path, serverConfig.stateDir, input.threadId);
      yield* fileSystem.makeDirectory(sessionDir, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: `Failed to prepare Pi session directory: ${sessionDir}`,
              cause,
            }),
        ),
      );

      const agentDir = input.providerOptions?.pi?.agentDir;
      const authStorage = AuthStorage.create(agentDir);
      const modelRegistry = new ModelRegistry(
        authStorage,
        agentDir ? path.join(agentDir, "models.json") : undefined,
      );
      const sessionFile =
        input.resumeCursor &&
        typeof input.resumeCursor === "object" &&
        input.resumeCursor !== null &&
        typeof (input.resumeCursor as { sessionFile?: unknown }).sessionFile === "string"
          ? (input.resumeCursor as { sessionFile: string }).sessionFile
          : undefined;
      const sessionManager = sessionFile
        ? SessionManager.open(sessionFile, sessionDir)
        : SessionManager.create(cwd, sessionDir);

      const requestedModel =
        input.modelSelection?.provider === "pi" ? input.modelSelection.model : "auto";
      const requestedThinkingLevel =
        input.modelSelection?.provider === "pi"
          ? input.modelSelection.options?.thinkingLevel
          : undefined;
      const resolvedModel =
        requestedModel !== "auto" ? modelFromSelection(modelRegistry, requestedModel) : undefined;

      if (requestedModel !== "auto" && !resolvedModel) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Unknown or unavailable Pi model: ${requestedModel}`,
        });
      }

      const created = yield* Effect.tryPromise({
        try: () =>
          createAgentSession({
            cwd,
            ...(agentDir ? { agentDir } : {}),
            authStorage,
            modelRegistry,
            sessionManager,
            ...(resolvedModel ? { model: resolvedModel } : {}),
            ...(requestedThinkingLevel ? { thinkingLevel: requestedThinkingLevel } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: cause instanceof Error ? cause.message : "Failed to start Pi session",
            cause,
          }),
      });

      const persistedSessionFile = created.session.sessionFile;
      if (!persistedSessionFile) {
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: "Pi session file was not created.",
        });
      }

      const context: PiSessionContext = {
        threadId: input.threadId,
        session: created.session,
        sessionManager: created.session.sessionManager,
        sessionFile: persistedSessionFile,
        cwd,
        agentDir,
        runtimeMode: "full-access",
        model: requestedModel ?? getModelSlug(created.session.model) ?? "auto",
        thinkingLevel: requestedThinkingLevel,
        unsubscribe: () => {},
        turns: [],
        activeTurnId: undefined,
        assistantItemId: undefined,
        stopped: false,
      };
      context.unsubscribe = attachListeners(context);
      sessions.set(input.threadId, context);

      const stamp = yield* makeStamp;
      yield* offerEvent({
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: input.threadId,
        type: "session.started",
        payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
        providerRefs: {},
      } satisfies Extract<ProviderRuntimeEvent, { type: "session.started" }>);

      return {
        provider: PROVIDER,
        status: "ready",
        runtimeMode: context.runtimeMode,
        cwd,
        model: context.model,
        threadId: input.threadId,
        resumeCursor: buildResumeCursor(context),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      } satisfies ProviderSession;
    });

  const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      if (context.activeTurnId) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/start",
          detail: "Pi session already has an active turn.",
        });
      }

      const requestedModel =
        input.modelSelection?.provider === "pi" ? input.modelSelection.model : context.model;
      const requestedThinkingLevel =
        input.modelSelection?.provider === "pi"
          ? input.modelSelection.options?.thinkingLevel
          : context.thinkingLevel;

      if (
        requestedModel &&
        requestedModel !== context.model &&
        (requestedModel === "auto" || context.model === "auto")
      ) {
        yield* restartSessionWithModel(context, requestedModel, requestedThinkingLevel);
      } else if (requestedModel && requestedModel !== "auto" && requestedModel !== context.model) {
        const resolved = modelFromSelection(context.session.modelRegistry, requestedModel);
        if (!resolved) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Unknown or unavailable Pi model: ${requestedModel}`,
          });
        }
        yield* Effect.tryPromise({
          try: () => context.session.setModel(resolved),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/setModel",
              detail: cause instanceof Error ? cause.message : "Failed to switch Pi model",
              cause,
            }),
        });
        context.model = requestedModel;
      }

      if (requestedThinkingLevel && requestedThinkingLevel !== context.thinkingLevel) {
        yield* Effect.sync(() => {
          context.session.setThinkingLevel(requestedThinkingLevel);
          context.thinkingLevel = requestedThinkingLevel;
        });
      }

      const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      context.activeTurnId = turnId;
      context.turns.push({ id: turnId, items: [] });

      const prompt =
        input.interactionMode === "plan"
          ? `${PLAN_PREFIX}\n\n${input.input ?? ""}`.trim()
          : (input.input ?? "").trim();
      const promptOptions = yield* Effect.tryPromise({
        try: () => buildPromptOptions(input, serverConfig.attachmentsDir, fileSystem),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/attachments",
            detail: cause instanceof Error ? cause.message : "Failed to prepare Pi attachments",
            cause,
          }),
      });

      yield* Effect.tryPromise({
        try: () => context.session.prompt(prompt, promptOptions),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/prompt",
            detail: cause instanceof Error ? cause.message : "Failed to send Pi prompt",
            cause,
          }),
      });

      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: buildResumeCursor(context),
      };
    });

  const interruptTurn: PiAdapterShape["interruptTurn"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((context) =>
        Effect.tryPromise({
          try: () => context.session.abort(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/interrupt",
              detail: cause instanceof Error ? cause.message : "Failed to interrupt Pi turn",
              cause,
            }),
        }),
      ),
    );

  const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((context) =>
        Effect.sync(() => {
          context.stopped = true;
          context.unsubscribe();
          context.session.dispose();
          sessions.delete(threadId);
        }),
      ),
    );

  const readThread: PiAdapterShape["readThread"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.map((context) => buildThreadSnapshot(threadId, context.turns)),
    );

  const rollbackThread: PiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    requireSession(threadId).pipe(
      Effect.flatMap((context) =>
        Effect.sync(() => {
          const retainCount = Math.max(0, context.turns.length - numTurns);
          const target = retainCount > 0 ? context.turns[retainCount - 1] : undefined;
          if (target?.entryId) {
            context.sessionManager.branch(target.entryId);
          } else if (retainCount === 0) {
            context.sessionManager.resetLeaf();
          }
          context.turns.splice(retainCount);
          return buildThreadSnapshot(threadId, context.turns);
        }),
      ),
    );

  const listSessions: PiAdapterShape["listSessions"] = () =>
    Effect.sync(() =>
      Array.from(sessions.values()).map((context) => {
        const session: ProviderSession = {
          provider: PROVIDER,
          status: context.activeTurnId ? "running" : "ready",
          runtimeMode: context.runtimeMode,
          cwd: context.cwd,
          model: context.model,
          threadId: context.threadId,
          resumeCursor: buildResumeCursor(context),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        if (context.activeTurnId) {
          (session as ProviderSession & { activeTurnId: TurnId }).activeTurnId =
            context.activeTurnId;
        }
        return session;
      }),
    );

  const hasSession: PiAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => sessions.has(threadId));

  const stopAll: PiAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
      discard: true,
    });

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: (_threadId: ThreadId, _requestId, _decision: ProviderApprovalDecision) =>
      Effect.fail(unsupportedInteractiveError("respondToRequest")),
    respondToUserInput: (_threadId: ThreadId, _requestId, _answers: ProviderUserInputAnswers) =>
      Effect.fail(unsupportedInteractiveError("respondToUserInput")),
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromQueue(eventQueue),
  } satisfies PiAdapterShape;
});

export const PiAdapterLive = Layer.effect(PiAdapter, makePiAdapter);

export function makePiAdapterLive() {
  return PiAdapterLive;
}

import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2";
import {
  EventId,
  MessageId,
  NativeHarnessSubagentId,
  TurnId,
  type NativeHarnessSubagentDetail,
  type NativeHarnessSubagentSummary,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type MessageEntry = {
  readonly info: Message;
  readonly parts: ReadonlyArray<Part>;
};

const iso = (milliseconds: number): string => DateTime.formatIso(DateTime.makeUnsafe(milliseconds));

export function openCodeNativeStatus(
  status: SessionStatus | undefined,
  messages?: ReadonlyArray<MessageEntry>,
): NativeHarnessSubagentSummary["status"] {
  if (messages?.some(({ info }) => info.role === "assistant" && info.error !== undefined)) {
    return "error";
  }
  if (status?.type === "busy" || status?.type === "retry") return "running";
  if (status?.type === "idle") return "done";
  return "unknown";
}

export function makeOpenCodeNativeSummary(input: {
  readonly provider: ProviderDriverKind;
  readonly session: Session;
  readonly status?: SessionStatus;
  readonly messages?: ReadonlyArray<MessageEntry>;
}): NativeHarnessSubagentSummary {
  const status = openCodeNativeStatus(input.status, input.messages);
  return {
    id: NativeHarnessSubagentId.make(input.session.id),
    provider: input.provider,
    title: input.session.title || input.session.agent || "Native agent",
    status,
    ...(input.status?.type === "retry" ? { statusDetail: input.status.message } : {}),
    ...(input.session.model ? { model: input.session.model.id } : {}),
    ...(input.session.agent ? { role: input.session.agent } : {}),
    cwd: input.session.directory,
    createdAt: iso(input.session.time.created),
    updatedAt: iso(input.session.time.updated),
    readOnly: true,
  };
}

export function normalizeOpenCodeNativeDetail(input: {
  readonly summary: NativeHarnessSubagentSummary;
  readonly entries: ReadonlyArray<MessageEntry>;
}): NativeHarnessSubagentDetail {
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  let sequence = 0;

  for (const entry of input.entries) {
    const createdAt = iso(entry.info.time.created);
    const turnId = TurnId.make(entry.info.id);
    for (const part of entry.parts) {
      if (part.type === "text") {
        messages.push({
          id: MessageId.make(part.id),
          role: entry.info.role,
          text: part.text,
          turnId,
          streaming: false,
          createdAt,
          updatedAt: iso(part.time?.end ?? part.time?.start ?? entry.info.time.created),
        });
        continue;
      }
      if (part.type === "reasoning") {
        activities.push({
          id: EventId.make(part.id),
          tone: "info",
          kind: "reasoning",
          summary: "Reasoning",
          payload: { text: part.text },
          turnId,
          sequence: sequence++,
          createdAt: iso(part.time.start),
        });
        continue;
      }
      if (part.type === "tool") {
        const completed = part.state.status === "completed" || part.state.status === "error";
        activities.push({
          id: EventId.make(part.id),
          tone: part.state.status === "error" ? "error" : "tool",
          kind: completed ? "tool.completed" : "tool.started",
          summary:
            part.state.status === "running" || part.state.status === "completed"
              ? (part.state.title ?? part.tool)
              : part.tool,
          payload: {
            itemType: "dynamic_tool_call",
            status:
              part.state.status === "error"
                ? "failed"
                : part.state.status === "completed"
                  ? "completed"
                  : "inProgress",
            data: { tool: part.tool, state: part.state },
          },
          turnId,
          sequence: sequence++,
          createdAt,
        });
        continue;
      }
      if (part.type === "subtask") {
        activities.push({
          id: EventId.make(part.id),
          tone: "tool",
          kind: "tool.completed",
          summary: part.description || part.agent,
          payload: {
            itemType: "collab_agent_tool_call",
            status: "completed",
            data: {
              tool: "spawnAgent",
              receiverThreadId: part.sessionID,
              prompt: part.prompt,
              agent: part.agent,
            },
          },
          turnId,
          sequence: sequence++,
          createdAt,
        });
        continue;
      }
      messages.push({
        id: MessageId.make(part.id),
        role: "system",
        text: `[Unsupported ${part.type} content]`,
        turnId,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  const lastEntry = input.entries[input.entries.length - 1];
  return {
    summary: input.summary,
    messages,
    activities,
    proposedPlans: [],
    latestTurn: lastEntry
      ? {
          turnId: TurnId.make(lastEntry.info.id),
          state:
            input.summary.status === "running"
              ? "running"
              : input.summary.status === "error"
                ? "error"
                : input.summary.status === "interrupted"
                  ? "interrupted"
                  : "completed",
          requestedAt: iso(lastEntry.info.time.created),
          startedAt: iso(lastEntry.info.time.created),
          completedAt:
            input.summary.status === "running"
              ? null
              : iso(
                  (lastEntry.info.role === "assistant"
                    ? lastEntry.info.time.completed
                    : undefined) ?? lastEntry.info.time.created,
                ),
          assistantMessageId: null,
        }
      : null,
  };
}

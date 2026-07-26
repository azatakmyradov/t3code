import type {
  NativeHarnessSubagentDetail,
  NativeHarnessSubagentStatus,
  NativeHarnessSubagentSummary,
  OrchestrationMessage,
  OrchestrationThreadActivity,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { EventId, MessageId, NativeHarnessSubagentId, TurnId } from "@t3tools/contracts";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import * as DateTime from "effect/DateTime";

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function contentBlocks(message: SessionMessage): ReadonlyArray<Record<string, unknown>> {
  const envelope = record(message.message);
  const content = envelope?.content;
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return Array.isArray(content)
    ? content.map((block) => record(block) ?? { type: "non-text", content: block })
    : content === undefined
      ? []
      : [{ type: "non-text", content }];
}

function displayTimestamp(base: string, index: number): string {
  return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(base), { milliseconds: index }));
}

function observedTimestamp(message: SessionMessage, base: string, index: number): string {
  const envelope = record(message.message);
  return text(envelope?.timestamp) ?? displayTimestamp(base, index);
}

export function claudeNativeTitle(
  messages: ReadonlyArray<SessionMessage>,
  agentType: string | undefined,
): string {
  for (const message of messages) {
    if (message.type !== "user") continue;
    for (const block of contentBlocks(message)) {
      const value = block.type === "text" ? text(block.text) : undefined;
      if (value) return value;
    }
  }
  return agentType ?? "Native agent";
}

export function makeClaudeNativeSummary(input: {
  readonly provider: ProviderDriverKind;
  readonly id: string;
  readonly messages: ReadonlyArray<SessionMessage>;
  readonly status: NativeHarnessSubagentStatus;
  readonly agentType?: string;
  readonly cwd?: string;
  readonly baseTimestamp: string;
  readonly updatedAt?: string;
}): NativeHarnessSubagentSummary {
  return {
    id: NativeHarnessSubagentId.make(input.id),
    provider: input.provider,
    title: claudeNativeTitle(input.messages, input.agentType),
    status: input.status,
    ...(input.status === "unknown" ? { statusDetail: "Status unavailable" } : {}),
    ...(input.agentType ? { role: input.agentType } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    createdAt:
      input.messages.length > 0
        ? observedTimestamp(input.messages[0]!, input.baseTimestamp, 0)
        : input.baseTimestamp,
    updatedAt:
      input.updatedAt ??
      (input.messages.length > 0
        ? observedTimestamp(
            input.messages[input.messages.length - 1]!,
            input.baseTimestamp,
            input.messages.length - 1,
          )
        : input.baseTimestamp),
    readOnly: true,
  };
}

export function normalizeClaudeNativeDetail(input: {
  readonly summary: NativeHarnessSubagentSummary;
  readonly messages: ReadonlyArray<SessionMessage>;
  readonly baseTimestamp: string;
}): NativeHarnessSubagentDetail {
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  let sequence = 0;

  for (const [messageIndex, source] of input.messages.entries()) {
    const createdAt = observedTimestamp(source, input.baseTimestamp, messageIndex);
    const turnId = TurnId.make(`native-${input.summary.id}-${messageIndex}`);
    for (const [blockIndex, block] of contentBlocks(source).entries()) {
      const blockType = text(block.type) ?? "unsupported";
      const id = `${input.summary.id}-${messageIndex}-${blockIndex}`;
      if (blockType === "text") {
        messages.push({
          id: MessageId.make(id),
          role:
            source.type === "assistant" ? "assistant" : source.type === "user" ? "user" : "system",
          text: text(block.text) ?? "",
          turnId,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        });
        continue;
      }

      if (blockType === "thinking") {
        activities.push({
          id: EventId.make(id),
          tone: "info",
          kind: "reasoning",
          summary: "Reasoning",
          payload: { text: text(block.thinking) ?? text(block.text) ?? "" },
          turnId,
          sequence: sequence++,
          createdAt,
        });
        continue;
      }

      if (blockType === "tool_use") {
        activities.push({
          id: EventId.make(id),
          tone: "tool",
          kind: "tool.started",
          summary: text(block.name) ?? "Tool call",
          payload: {
            itemType: "dynamic_tool_call",
            status: "inProgress",
            data: { id: block.id, input: block.input },
          },
          turnId,
          sequence: sequence++,
          createdAt,
        });
        continue;
      }

      if (blockType === "tool_result") {
        activities.push({
          id: EventId.make(id),
          tone: block.is_error === true ? "error" : "tool",
          kind: "tool.completed",
          summary: block.is_error === true ? "Tool failed" : "Tool result",
          payload: {
            itemType: "dynamic_tool_call",
            status: block.is_error === true ? "failed" : "completed",
            data: { toolUseId: block.tool_use_id, content: block.content },
          },
          turnId,
          sequence: sequence++,
          createdAt,
        });
        continue;
      }

      messages.push({
        id: MessageId.make(id),
        role: "system",
        text: `[Unsupported ${blockType} content]`,
        turnId,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  const lastTimestamp =
    input.messages.length > 0
      ? observedTimestamp(
          input.messages[input.messages.length - 1]!,
          input.baseTimestamp,
          input.messages.length - 1,
        )
      : input.baseTimestamp;
  const latestTurn =
    input.messages.length === 0
      ? null
      : {
          turnId: TurnId.make(`native-${input.summary.id}-${input.messages.length - 1}`),
          state:
            input.summary.status === "running"
              ? ("running" as const)
              : input.summary.status === "interrupted"
                ? ("interrupted" as const)
                : input.summary.status === "error"
                  ? ("error" as const)
                  : ("completed" as const),
          requestedAt: input.summary.createdAt ?? input.baseTimestamp,
          startedAt: input.summary.createdAt,
          completedAt: input.summary.status === "running" ? null : lastTimestamp,
          assistantMessageId: null,
        };

  return {
    summary: input.summary,
    messages,
    activities,
    proposedPlans: [],
    latestTurn,
  };
}

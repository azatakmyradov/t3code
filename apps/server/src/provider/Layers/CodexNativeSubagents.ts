import {
  EventId,
  MessageId,
  NativeHarnessSubagentId,
  ProviderDriverKind,
  TurnId,
  type NativeHarnessSubagentDetail,
  type NativeHarnessSubagentStatus,
  type NativeHarnessSubagentSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import type { CodexNativeThreadSnapshot } from "./CodexSessionRuntime.ts";

const PROVIDER = ProviderDriverKind.make("codex");

type CodexThreadItem =
  EffectCodexSchema.V2ThreadReadResponse["thread"]["turns"][number]["items"][number];
type CodexCollabItem = Extract<CodexThreadItem, { readonly type: "collabAgentToolCall" }>;
type CodexSubAgentActivityItem = Extract<CodexThreadItem, { readonly type: "subAgentActivity" }>;
export type CodexSpawnItem = CodexCollabItem & { readonly tool: "spawnAgent" };
export type CodexNativeChildReference = {
  readonly receiverThreadId: string;
  readonly spawn?: CodexSpawnItem;
  readonly activity?: CodexSubAgentActivityItem;
};

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function secondsToIso(value: number | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : DateTime.formatIso(DateTime.makeUnsafe(value * 1_000));
}

function itemTimestamp(thread: CodexNativeThreadSnapshot, turnIndex: number, itemIndex: number) {
  const turn = thread.turns[turnIndex];
  const baseSeconds = turn?.startedAt ?? thread.createdAt + turnIndex;
  return DateTime.formatIso(DateTime.makeUnsafe(baseSeconds * 1_000 + itemIndex));
}

function statusFromAgentState(
  status: EffectCodexSchema.V2ThreadReadResponse__CollabAgentStatus | undefined,
): NativeHarnessSubagentStatus | undefined {
  switch (status) {
    case "pendingInit":
    case "running":
      return "running";
    case "completed":
    case "shutdown":
      return "done";
    case "interrupted":
      return "interrupted";
    case "errored":
    case "notFound":
      return "error";
    default:
      return undefined;
  }
}

export function codexNativeSubagentStatus(
  thread: CodexNativeThreadSnapshot,
  spawn: CodexSpawnItem | undefined,
): NativeHarnessSubagentStatus {
  const latestTurn = thread.turns.at(-1);
  if (thread.status.type === "active" || latestTurn?.status === "inProgress") {
    return "running";
  }
  if (latestTurn?.status === "interrupted") {
    return "interrupted";
  }
  if (thread.status.type === "systemError" || latestTurn?.status === "failed") {
    return "error";
  }
  const observed = statusFromAgentState(spawn?.agentsStates[thread.id]?.status);
  if (observed) {
    return observed;
  }
  if (thread.status.type === "idle" || latestTurn?.status === "completed") {
    return "done";
  }
  return "unknown";
}

function promptTitle(prompt: string | null | undefined): string | undefined {
  const firstLine = nonEmpty(prompt)?.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) return undefined;
  return firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine;
}

export function codexNativeSubagentSummary(
  thread: CodexNativeThreadSnapshot,
  spawn?: CodexSpawnItem,
): NativeHarnessSubagentSummary {
  const state = spawn?.agentsStates[thread.id];
  const statusDetail = nonEmpty(state?.message);
  const model = nonEmpty(spawn?.model);
  const role = nonEmpty(thread.agentRole);
  const cwd = nonEmpty(thread.cwd);
  const title =
    nonEmpty(thread.agentNickname) ??
    nonEmpty(thread.agentRole) ??
    nonEmpty(thread.name) ??
    promptTitle(spawn?.prompt) ??
    "Native agent";
  return {
    id: NativeHarnessSubagentId.make(thread.id),
    provider: PROVIDER,
    title,
    status: codexNativeSubagentStatus(thread, spawn),
    ...(statusDetail ? { statusDetail } : {}),
    ...(model ? { model } : {}),
    ...(role ? { role } : {}),
    ...(cwd ? { cwd } : {}),
    createdAt: secondsToIso(thread.createdAt),
    updatedAt: secondsToIso(thread.updatedAt),
    readOnly: true,
  };
}

export function codexSpawnItems(thread: CodexNativeThreadSnapshot): ReadonlyArray<CodexSpawnItem> {
  return thread.turns.flatMap((turn) =>
    turn.items.filter(
      (item): item is CodexSpawnItem =>
        item.type === "collabAgentToolCall" && item.tool === "spawnAgent",
    ),
  );
}

export function codexNativeChildReferences(
  thread: CodexNativeThreadSnapshot,
): ReadonlyArray<CodexNativeChildReference> {
  const references: CodexNativeChildReference[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent") {
        const spawn = item as CodexSpawnItem;
        for (const receiverThreadId of item.receiverThreadIds) {
          references.push({ receiverThreadId, spawn });
        }
      } else if (item.type === "subAgentActivity" && item.kind === "started") {
        references.push({ receiverThreadId: item.agentThreadId, activity: item });
      }
    }
  }
  return references;
}

function contentPlaceholder(content: Record<string, unknown>): string {
  const type = typeof content.type === "string" ? content.type : "non-text";
  switch (type) {
    case "image":
    case "localImage":
      return "[Image content]";
    case "localAudio":
      return "[Audio content]";
    case "skill":
      return `[Skill content${typeof content.name === "string" ? `: ${content.name}` : ""}]`;
    case "mention":
      return `[Mention${typeof content.name === "string" ? `: ${content.name}` : ""}]`;
    default:
      return `[Unsupported ${type} content]`;
  }
}

function userMessageText(item: Extract<CodexThreadItem, { type: "userMessage" }>): string {
  return item.content
    .map((content) => {
      const record = content as unknown as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        return record.text;
      }
      return contentPlaceholder(record);
    })
    .join("\n");
}

function activityForItem(
  item: Exclude<CodexThreadItem, { type: "userMessage" | "agentMessage" | "hookPrompt" }>,
  turnId: TurnId,
  createdAt: string,
): OrchestrationThreadActivity | null {
  const base = {
    id: EventId.make(`native:codex:${item.id}`),
    turnId,
    createdAt,
  };
  switch (item.type) {
    case "reasoning": {
      const detail = [...(item.summary ?? []), ...(item.content ?? [])].join("\n").trim();
      return {
        ...base,
        tone: "info",
        kind: "reasoning",
        summary: "Reasoning",
        payload: detail ? { detail } : {},
      };
    }
    case "plan":
      return {
        ...base,
        tone: "info",
        kind: "plan",
        summary: "Plan",
        payload: { detail: item.text },
      };
    case "commandExecution":
      return {
        ...base,
        tone: item.status === "failed" ? "error" : "tool",
        kind: item.status === "inProgress" ? "tool.updated" : "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          status: item.status,
          detail: item.aggregatedOutput ?? item.command,
          data: { item },
        },
      };
    case "fileChange":
      return {
        ...base,
        tone: item.status === "failed" ? "error" : "tool",
        kind: item.status === "inProgress" ? "tool.updated" : "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          status: item.status,
          detail: item.changes.map((change) => change.path).join("\n"),
          data: { item },
        },
      };
    case "mcpToolCall":
      return {
        ...base,
        tone: item.status === "failed" ? "error" : "tool",
        kind: item.status === "inProgress" ? "tool.updated" : "tool.completed",
        summary: `${item.server} · ${item.tool}`,
        payload: {
          itemType: "mcp_tool_call",
          status: item.status,
          detail: item.error?.message ?? undefined,
          data: { item },
        },
      };
    case "dynamicToolCall":
      return {
        ...base,
        tone: item.status === "failed" ? "error" : "tool",
        kind: item.status === "inProgress" ? "tool.updated" : "tool.completed",
        summary: item.tool,
        payload: {
          itemType: "dynamic_tool_call",
          status: item.status,
          data: { item },
        },
      };
    case "collabAgentToolCall":
      return {
        ...base,
        tone: item.status === "failed" ? "error" : "tool",
        kind: item.status === "inProgress" ? "tool.updated" : "tool.completed",
        summary: item.tool,
        payload: {
          itemType: "collab_agent_tool_call",
          status: item.status,
          detail: item.prompt ?? undefined,
          data: { item },
        },
      };
    case "webSearch":
      return {
        ...base,
        tone: "tool",
        kind: "tool.completed",
        summary: "Web search",
        payload: { itemType: "web_search", detail: item.query, data: { item } },
      };
    case "imageView":
      return {
        ...base,
        tone: "tool",
        kind: "tool.completed",
        summary: "Viewed image",
        payload: { itemType: "image_view", detail: item.path, data: { item } },
      };
    case "subAgentActivity":
      return {
        ...base,
        tone: "tool",
        kind: "tool.completed",
        summary: "Subagent activity",
        payload: {
          itemType: "collab_agent_tool_call",
          detail: `${item.kind}: ${item.agentPath}`,
          data: { item },
        },
      };
    case "contextCompaction":
      return {
        ...base,
        tone: "info",
        kind: "context.compaction",
        summary: "Context compacted",
        payload: {},
      };
    case "enteredReviewMode":
    case "exitedReviewMode":
      return {
        ...base,
        tone: "info",
        kind: item.type,
        summary: item.type === "enteredReviewMode" ? "Entered review" : "Exited review",
        payload: { detail: item.review },
      };
    case "sleep":
      return {
        ...base,
        tone: "info",
        kind: "sleep",
        summary: "Waited",
        payload: { detail: `${item.durationMs} ms` },
      };
    case "imageGeneration":
      return {
        ...base,
        tone: item.status.toLowerCase().includes("fail") ? "error" : "tool",
        kind: "image.generation",
        summary: "Generated image",
        payload: { detail: item.result },
      };
    default:
      return null;
  }
}

function latestTurnForThread(
  thread: CodexNativeThreadSnapshot,
  assistantMessageId: MessageId | null,
): OrchestrationLatestTurn | null {
  const turn = thread.turns.at(-1);
  if (!turn) return null;
  const state =
    turn.status === "inProgress"
      ? "running"
      : turn.status === "interrupted"
        ? "interrupted"
        : turn.status === "failed"
          ? "error"
          : "completed";
  const requestedAt = secondsToIso(turn.startedAt) ?? secondsToIso(thread.createdAt)!;
  return {
    turnId: TurnId.make(turn.id),
    state,
    requestedAt,
    startedAt: secondsToIso(turn.startedAt),
    completedAt: secondsToIso(turn.completedAt),
    assistantMessageId,
  };
}

export function normalizeCodexNativeSubagent(
  thread: CodexNativeThreadSnapshot,
  spawn?: CodexSpawnItem,
): NativeHarnessSubagentDetail {
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  const proposedPlans: OrchestrationProposedPlan[] = [];
  let latestAssistantMessageId: MessageId | null = null;

  thread.turns.forEach((turn, turnIndex) => {
    const turnId = TurnId.make(turn.id);
    turn.items.forEach((item, itemIndex) => {
      if (item.type === "hookPrompt") return;
      const createdAt = itemTimestamp(thread, turnIndex, itemIndex);
      if (item.type === "userMessage" || item.type === "agentMessage") {
        const text = item.type === "userMessage" ? userMessageText(item) : item.text;
        const id = MessageId.make(`native:codex:${item.id}`);
        messages.push({
          id,
          role: item.type === "userMessage" ? "user" : "assistant",
          text,
          turnId,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        });
        if (item.type === "agentMessage") {
          latestAssistantMessageId = id;
        }
        return;
      }
      const activity = activityForItem(item, turnId, createdAt);
      if (activity) activities.push(activity);
      if (item.type === "plan" && nonEmpty(item.text)) {
        proposedPlans.push({
          id: item.id,
          turnId,
          planMarkdown: item.text.trim(),
          implementedAt: null,
          implementationThreadId: null,
          createdAt,
          updatedAt: createdAt,
        });
      }
    });
  });

  return {
    summary: codexNativeSubagentSummary(thread, spawn),
    messages,
    activities,
    proposedPlans,
    latestTurn: latestTurnForThread(thread, latestAssistantMessageId),
  };
}

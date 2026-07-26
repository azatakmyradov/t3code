import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Message, Part, Session } from "@opencode-ai/sdk/v2";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import { makeClaudeNativeSummary, normalizeClaudeNativeDetail } from "./ClaudeNativeSubagents.ts";
import {
  codexNativeChildReferences,
  codexNativeSubagentStatus,
  codexSpawnItems,
  normalizeCodexNativeSubagent,
} from "./CodexNativeSubagents.ts";
import type { CodexNativeThreadSnapshot } from "./CodexSessionRuntime.ts";
import {
  makeOpenCodeNativeSummary,
  normalizeOpenCodeNativeDetail,
} from "./OpenCodeNativeSubagents.ts";

const PROVIDER_CLAUDE = ProviderDriverKind.make("claudeAgent");
const PROVIDER_OPENCODE = ProviderDriverKind.make("opencode");

it("normalizes Claude text, thinking, tool calls, and historical unknown status", () => {
  const source = [
    {
      type: "user",
      uuid: "u1",
      session_id: "parent",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text: "Research the issue" }] },
    },
    {
      type: "assistant",
      uuid: "a1",
      session_id: "parent",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "thinking", thinking: "Inspect files" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file: "a.ts" } },
          { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
          { type: "text", text: "Done" },
        ],
      },
    },
  ] satisfies SessionMessage[];
  const summary = makeClaudeNativeSummary({
    provider: PROVIDER_CLAUDE,
    id: "agent-1",
    messages: source,
    status: "unknown",
    baseTimestamp: "2026-01-01T00:00:00.000Z",
  });
  const detail = normalizeClaudeNativeDetail({
    summary,
    messages: source,
    baseTimestamp: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(summary.title, "Research the issue");
  assert.equal(summary.statusDetail, "Status unavailable");
  assert.deepEqual(
    detail.messages.map(({ text }) => text),
    ["Research the issue", "Done"],
  );
  assert.deepEqual(
    detail.activities.map(({ kind }) => kind),
    ["reasoning", "tool.started", "tool.completed"],
  );
});

it("normalizes OpenCode session status, messages, reasoning, tools, and subtasks", () => {
  const session = {
    id: "child-1",
    slug: "child",
    projectID: "project",
    directory: "/repo",
    title: "Native child",
    version: "1",
    time: { created: 1_767_225_600_000, updated: 1_767_225_601_000 },
  } satisfies Session;
  const entries = [
    {
      info: {
        id: "assistant-1",
        sessionID: "child-1",
        role: "assistant",
        time: { created: 1_767_225_600_000, completed: 1_767_225_601_000 },
        parentID: "user-1",
        modelID: "model",
        providerID: "provider",
        mode: "default",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      } satisfies Message,
      parts: [
        {
          id: "text-1",
          sessionID: "child-1",
          messageID: "assistant-1",
          type: "text",
          text: "Finished",
        },
        {
          id: "reasoning-1",
          sessionID: "child-1",
          messageID: "assistant-1",
          type: "reasoning",
          text: "Working",
          time: { start: 1_767_225_600_000 },
        },
        {
          id: "subtask-1",
          sessionID: "child-1",
          messageID: "assistant-1",
          type: "subtask",
          prompt: "Nested task",
          description: "Nested",
          agent: "research",
        },
      ] satisfies Part[],
    },
  ];
  const summary = makeOpenCodeNativeSummary({
    provider: PROVIDER_OPENCODE,
    session,
    status: { type: "busy" },
    messages: entries,
  });
  const detail = normalizeOpenCodeNativeDetail({ summary, entries });

  assert.equal(summary.status, "running");
  assert.equal(detail.messages[0]?.text, "Finished");
  assert.deepEqual(
    detail.activities.map(({ kind }) => kind),
    ["reasoning", "tool.completed"],
  );
  const subtaskActivity = detail.activities[1];
  assert.isDefined(subtaskActivity);
  assert.equal(
    (subtaskActivity.payload as { itemType?: string }).itemType,
    "collab_agent_tool_call",
  );
});

it("maps Codex native status and preserves spawn-only discovery plus transcript order", () => {
  const spawn = {
    id: "spawn-1",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    status: "completed",
    receiverThreadId: "child-1",
    prompt: "Do work",
    agentsStates: { "child-1": { status: "completed" } },
  };
  const child = {
    id: "child-1",
    name: "Child",
    agentNickname: "Researcher",
    agentRole: "research",
    cwd: "/repo",
    createdAt: 1_767_225_600,
    updatedAt: 1_767_225_601,
    status: { type: "idle" },
    turns: [
      {
        id: "turn-1",
        status: "completed",
        startedAt: 1_767_225_600,
        completedAt: 1_767_225_601,
        items: [
          { id: "user-1", type: "userMessage", content: [{ type: "text", text: "Question" }] },
          { id: "hook-1", type: "hookPrompt", prompt: "internal" },
          { id: "reason-1", type: "reasoning", summary: ["Think"], content: [] },
          { id: "agent-1", type: "agentMessage", text: "Answer", phase: null },
        ],
      },
    ],
  } as unknown as CodexNativeThreadSnapshot;
  const parent = {
    ...child,
    id: "parent",
    turns: [
      {
        ...child.turns[0],
        items: [spawn, { ...spawn, id: "send-1", tool: "sendInput", receiverThreadId: "child-1" }],
      },
    ],
  } as unknown as CodexNativeThreadSnapshot;

  assert.equal(codexSpawnItems(parent).length, 1);
  const activityParent = {
    ...parent,
    turns: [
      {
        ...parent.turns[0],
        items: [
          {
            id: "activity-1",
            type: "subAgentActivity",
            kind: "started",
            agentPath: "/root/researcher",
            agentThreadId: "child-1",
          },
        ],
      },
    ],
  } as unknown as CodexNativeThreadSnapshot;
  assert.equal(codexNativeChildReferences(activityParent)[0]?.receiverThreadId, "child-1");
  assert.equal(codexNativeSubagentStatus(child, spawn as never), "done");
  const detail = normalizeCodexNativeSubagent(child, spawn as never);
  assert.deepEqual(
    detail.messages.map(({ text }) => text),
    ["Question", "Answer"],
  );
  assert.deepEqual(
    detail.activities.map(({ kind }) => kind),
    ["reasoning"],
  );
});

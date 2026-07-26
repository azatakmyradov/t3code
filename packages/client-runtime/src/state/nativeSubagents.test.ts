import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import {
  hasNativeSubagentActivity,
  isNativeSubagentActivity,
  nativeSubagentListQueryKey,
  nativeSubagentReadQueryKey,
} from "./nativeSubagents.ts";

const activity = (kind: string, itemType: string): OrchestrationThreadActivity => ({
  id: EventId.make(`${kind}-${itemType}`),
  tone: "tool",
  kind,
  summary: "tool",
  payload: { itemType },
  turnId: TurnId.make("turn-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
});

it("scopes native query keys by environment, parent, and child", () => {
  const list = nativeSubagentListQueryKey({
    environmentId: EnvironmentId.make("environment-1"),
    input: { threadId: "parent-1" },
  });
  assert.notEqual(
    list,
    nativeSubagentListQueryKey({
      environmentId: EnvironmentId.make("environment-2"),
      input: { threadId: "parent-1" },
    }),
  );
  assert.notEqual(
    list,
    nativeSubagentListQueryKey({
      environmentId: EnvironmentId.make("environment-1"),
      input: { threadId: "parent-2" },
    }),
  );
  assert.notEqual(
    nativeSubagentReadQueryKey({
      environmentId: EnvironmentId.make("environment-1"),
      input: { threadId: "parent-1", nativeSubagentId: "child-1" },
    }),
    nativeSubagentReadQueryKey({
      environmentId: EnvironmentId.make("environment-1"),
      input: { threadId: "parent-1", nativeSubagentId: "child-2" },
    }),
  );
});

it("detects only canonical native collaboration lifecycle activities", () => {
  assert.isTrue(isNativeSubagentActivity(activity("tool.started", "collab_agent_tool_call")));
  assert.isTrue(isNativeSubagentActivity(activity("tool.completed", "collab_agent_tool_call")));
  assert.isFalse(isNativeSubagentActivity(activity("subagent.spawned", "collab_agent_tool_call")));
  assert.isFalse(isNativeSubagentActivity(activity("tool.completed", "command_execution")));
  assert.isTrue(
    hasNativeSubagentActivity([
      activity("tool.completed", "command_execution"),
      activity("tool.updated", "collab_agent_tool_call"),
    ]),
  );
});

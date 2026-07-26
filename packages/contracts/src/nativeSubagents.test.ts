import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  NativeHarnessSubagentDetail,
  NativeHarnessSubagentListInput,
  NativeHarnessSubagentListResult,
  NativeHarnessSubagentReadError,
  NativeHarnessSubagentReadInput,
  NativeHarnessSubagentSummary,
} from "./nativeSubagents.ts";

const decodeSummary = Schema.decodeUnknownSync(NativeHarnessSubagentSummary);
const decodeDetail = Schema.decodeUnknownSync(NativeHarnessSubagentDetail);
const decodeListInput = Schema.decodeUnknownSync(NativeHarnessSubagentListInput);
const decodeListResult = Schema.decodeUnknownSync(NativeHarnessSubagentListResult);
const decodeReadInput = Schema.decodeUnknownSync(NativeHarnessSubagentReadInput);
const decodeReadError = Schema.decodeUnknownSync(NativeHarnessSubagentReadError);

const summary = {
  id: "provider-child-1",
  provider: "codex",
  title: "Researcher",
  status: "running",
  statusDetail: "Waiting on a tool",
  model: "gpt-5.6",
  role: "research",
  cwd: "/workspace",
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:01:00.000Z",
  readOnly: true,
} as const;

it("decodes native subagent summary, detail, list, and read contracts", () => {
  const decodedSummary = decodeSummary(summary);
  assert.strictEqual(decodedSummary.id, "provider-child-1");
  assert.strictEqual(decodedSummary.readOnly, true);

  const decodedDetail = decodeDetail({
    summary,
    messages: [],
    activities: [],
    proposedPlans: [],
    latestTurn: null,
  });
  assert.strictEqual(decodedDetail.summary.title, "Researcher");

  const decodedListInput = decodeListInput({
    threadId: "parent-1",
  });
  assert.strictEqual(decodedListInput.threadId, "parent-1");

  const decodedList = decodeListResult({
    subagents: [summary],
  });
  assert.strictEqual(decodedList.subagents.length, 1);

  const decodedRead = decodeReadInput({
    threadId: "parent-1",
    nativeSubagentId: "provider-child-1",
  });
  assert.strictEqual(decodedRead.nativeSubagentId, "provider-child-1");
});

it("decodes each typed native subagent read error reason", () => {
  for (const reason of [
    "parent_not_found",
    "subagent_not_found",
    "provider_unsupported",
    "provider_unavailable",
  ] as const) {
    const decoded = decodeReadError({
      _tag: "NativeHarnessSubagentReadError",
      reason,
      message: `Native subagent failure: ${reason}`,
    });
    assert.strictEqual(decoded.reason, reason);
  }
});

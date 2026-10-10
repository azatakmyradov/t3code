import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectActiveProviderThreadUsage } from "./providerTurnUsage";

type Projection = NonNullable<Parameters<typeof selectActiveProviderThreadUsage>[0]>;
const providerThreadId = ProviderThreadId.make("active-thread");
const attemptId = RunAttemptId.make("attempt");
const runId = RunId.make("run");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const nativeThreadRef = {
  driver: ProviderDriverKind.make("codex"),
  nativeId: "native-thread",
  strength: "strong" as const,
};
const usage = { usedTokens: 10_000, maxTokens: 100_000, updatedAt: "2026-10-10T12:00:00Z" };

function makeProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    thread: { activeProviderThreadId: providerThreadId },
    providerThreads: [{ id: providerThreadId, nativeThreadRef, lastRunOrdinal: 1 }],
    providerTurns: [{ providerThreadId, ordinal: 1, runAttemptId: attemptId, tokenUsage: usage }],
    attempts: [
      {
        id: attemptId,
        runId,
        providerThreadId,
        nativeThreadId: nativeThreadRef.nativeId,
        status: "completed",
      },
    ],
    runs: [
      {
        id: runId,
        ordinal: 1,
        providerThreadId,
        modelSelection,
        status: "completed",
        activeAttemptId: attemptId,
      },
    ],
    ...overrides,
  };
}

describe("active provider-thread context usage", () => {
  it("selects by ordinal within the active provider thread instead of array order", () => {
    const projection = makeProjection();
    const turn = projection.providerTurns[0]!;
    const latestUsage = { ...usage, usedTokens: 20_000 };
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerTurns: [
          { ...turn, ordinal: 2, tokenUsage: latestUsage },
          turn,
          {
            ...turn,
            ordinal: 99,
            providerThreadId: ProviderThreadId.make("other-provider-thread"),
          },
        ],
      }),
    ).toEqual({ usage: latestUsage, allowFallback: true });
  });

  it("retains the latest report until the next turn reports its own usage", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerTurns: [
          ...projection.providerTurns,
          { ...projection.providerTurns[0]!, ordinal: 2, tokenUsage: undefined },
        ],
      }),
    ).toEqual({ usage, allowFallback: true });
  });

  it("never falls back to another provider thread after a handoff", () => {
    expect(
      selectActiveProviderThreadUsage(
        makeProjection({
          thread: { activeProviderThreadId: ProviderThreadId.make("new-provider") },
        }),
      ),
    ).toEqual({ usage: null, allowFallback: false });
  });

  it("returns no report for missing or unselected thread data", () => {
    expect(selectActiveProviderThreadUsage(null)).toEqual({ usage: null, allowFallback: false });
    expect(selectActiveProviderThreadUsage(makeProjection({ providerTurns: [] }))).toEqual({
      usage: null,
      allowFallback: true,
    });
    expect(
      selectActiveProviderThreadUsage(makeProjection({ thread: { activeProviderThreadId: null } })),
    ).toEqual({ usage: null, allowFallback: false });
  });

  it("does not resurrect usage from a rewound run or superseded attempt", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        runs: [{ ...projection.runs[0]!, status: "rolled_back" }],
      }),
    ).toEqual({ usage: null, allowFallback: false });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        attempts: [{ ...projection.attempts[0]!, status: "superseded" }],
      }),
    ).toEqual({ usage: null, allowFallback: false });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        runs: [{ ...projection.runs[0]!, activeAttemptId: RunAttemptId.make("new-attempt") }],
      }),
    ).toEqual({ usage: null, allowFallback: false });
  });

  it("requires an owning run and attempt when the turn names one", () => {
    expect(selectActiveProviderThreadUsage(makeProjection({ attempts: [] }))).toEqual({
      usage: null,
      allowFallback: false,
    });
    expect(selectActiveProviderThreadUsage(makeProjection({ runs: [] }))).toEqual({
      usage: null,
      allowFallback: false,
    });
  });

  it("allows context reported by a runless provider subagent in its own thread", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerTurns: [{ ...projection.providerTurns[0]!, runAttemptId: null }],
        runs: [],
        attempts: [],
      }),
    ).toEqual({ usage, allowFallback: true });
  });

  it("suppresses all fallbacks when a durable row now points at a different native session", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerThreads: [
          {
            ...projection.providerThreads[0]!,
            nativeThreadRef: { ...nativeThreadRef, nativeId: "replacement" },
          },
        ],
      }),
    ).toEqual({ usage: null, allowFallback: false });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        attempts: [{ ...projection.attempts[0]!, nativeThreadId: undefined }],
      }),
    ).toEqual({ usage: null, allowFallback: false });
  });

  it("resumes presentation when the replacement session reports valid new usage", () => {
    const projection = makeProjection();
    const newAttemptId = RunAttemptId.make("replacement-attempt");
    const nextRunId = RunId.make("replacement-run");
    const nextUsage = { ...usage, usedTokens: 500 };
    const updated = {
      ...projection,
      providerThreads: [
        {
          ...projection.providerThreads[0]!,
          lastRunOrdinal: 2,
          nativeThreadRef: { ...nativeThreadRef, nativeId: "replacement" },
        },
      ],
      providerTurns: [
        ...projection.providerTurns,
        {
          ...projection.providerTurns[0]!,
          ordinal: 2,
          runAttemptId: newAttemptId,
          tokenUsage: undefined,
        },
      ],
      attempts: [
        ...projection.attempts,
        {
          ...projection.attempts[0]!,
          id: newAttemptId,
          runId: nextRunId,
          nativeThreadId: "replacement",
        },
      ],
      runs: [
        ...projection.runs,
        { ...projection.runs[0]!, id: nextRunId, ordinal: 2, activeAttemptId: newAttemptId },
      ],
    };
    expect(selectActiveProviderThreadUsage(updated)).toEqual({ usage: null, allowFallback: false });
    expect(
      selectActiveProviderThreadUsage({
        ...updated,
        providerTurns: [
          updated.providerTurns[0]!,
          { ...updated.providerTurns[1]!, tokenUsage: nextUsage },
        ],
      }),
    ).toEqual({ usage: nextUsage, allowFallback: true });
  });

  it("uses the server-adjusted context window after a model switch on the same native session", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerThreads: [{ ...projection.providerThreads[0]!, lastRunOrdinal: 2 }],
        runs: [
          ...projection.runs,
          {
            ...projection.runs[0]!,
            id: RunId.make("switched-model"),
            ordinal: 2,
            modelSelection: { ...modelSelection, model: "smaller-model" },
          },
        ],
      }),
    ).toEqual({ usage: null, allowFallback: true });
  });

  it("blocks fallback after a newer unmeasured turn is rolled back", () => {
    const projection = makeProjection();
    const rolledBackAttemptId = RunAttemptId.make("rolled-back-attempt");
    const rolledBackRunId = RunId.make("rolled-back-run");
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerTurns: [
          ...projection.providerTurns,
          {
            ...projection.providerTurns[0]!,
            ordinal: 2,
            runAttemptId: rolledBackAttemptId,
            tokenUsage: undefined,
          },
        ],
        attempts: [
          ...projection.attempts,
          { ...projection.attempts[0]!, id: rolledBackAttemptId, runId: rolledBackRunId },
        ],
        runs: [
          ...projection.runs,
          {
            ...projection.runs[0]!,
            id: rolledBackRunId,
            ordinal: 2,
            activeAttemptId: rolledBackAttemptId,
            status: "rolled_back",
          },
        ],
      }),
    ).toEqual({ usage: null, allowFallback: false });
  });
});

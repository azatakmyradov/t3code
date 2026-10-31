import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
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
    providerThreads: [
      {
        id: providerThreadId,
        providerInstanceId: modelSelection.instanceId,
        nativeThreadRef,
        lastRunOrdinal: 1,
        nativeMetadata: null,
      },
    ],
    providerTurns: [{ providerThreadId, ordinal: 1, runAttemptId: attemptId, tokenUsage: usage }],
    attempts: [
      {
        id: attemptId,
        runId,
        providerThreadId,
        nativeThreadId: nativeThreadRef.nativeId,
        providerInstanceId: modelSelection.instanceId,
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
        startedAt: DateTime.makeUnsafe("2026-10-10T11:59:00Z"),
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
    ).toEqual({ usage: latestUsage, allowFallback: true, modelSelection });
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
    ).toEqual({ usage, allowFallback: true, modelSelection });
  });

  it("never falls back to another provider thread after a handoff", () => {
    expect(
      selectActiveProviderThreadUsage(
        makeProjection({
          thread: { activeProviderThreadId: ProviderThreadId.make("new-provider") },
        }),
      ),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
  });

  it("returns no report for missing or unselected thread data", () => {
    expect(selectActiveProviderThreadUsage(null)).toEqual({
      usage: null,
      allowFallback: false,
      modelSelection: null,
    });
    expect(selectActiveProviderThreadUsage(makeProjection({ providerTurns: [] }))).toEqual({
      usage: null,
      allowFallback: true,
      modelSelection,
    });
    expect(
      selectActiveProviderThreadUsage(makeProjection({ thread: { activeProviderThreadId: null } })),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
  });

  it("does not resurrect usage from a rewound run or superseded attempt", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        runs: [{ ...projection.runs[0]!, status: "rolled_back" }],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        attempts: [{ ...projection.attempts[0]!, status: "superseded" }],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        runs: [{ ...projection.runs[0]!, activeAttemptId: RunAttemptId.make("new-attempt") }],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
  });

  it("requires an owning run and attempt when the turn names one", () => {
    expect(selectActiveProviderThreadUsage(makeProjection({ attempts: [] }))).toEqual({
      usage: null,
      allowFallback: false,
      modelSelection: null,
    });
    expect(selectActiveProviderThreadUsage(makeProjection({ runs: [] }))).toEqual({
      usage: null,
      allowFallback: false,
      modelSelection: null,
    });
  });

  it("allows context reported by a runless provider subagent in its own thread", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerThreads: [
          { ...projection.providerThreads[0]!, nativeMetadata: { modelSelection } },
        ],
        providerTurns: [{ ...projection.providerTurns[0]!, runAttemptId: null }],
        runs: [],
        attempts: [],
      }),
    ).toEqual({ usage, allowFallback: true, modelSelection });
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
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        attempts: [{ ...projection.attempts[0]!, nativeThreadId: undefined }],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
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
    expect(selectActiveProviderThreadUsage(updated)).toEqual({
      usage: null,
      allowFallback: false,
      modelSelection: null,
    });
    expect(
      selectActiveProviderThreadUsage({
        ...updated,
        providerTurns: [
          updated.providerTurns[0]!,
          { ...updated.providerTurns[1]!, tokenUsage: nextUsage },
        ],
      }),
    ).toEqual({ usage: nextUsage, allowFallback: true, modelSelection });
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
    ).toEqual({
      usage: null,
      allowFallback: true,
      modelSelection: { ...modelSelection, model: "smaller-model" },
    });
  });

  it.each(["starting", "failed"] as const)(
    "keeps measured context on its original model when a new model run is %s but never started",
    (status) => {
      const projection = makeProjection();
      const nextModelSelection = { ...modelSelection, model: "smaller-model" };
      expect(
        selectActiveProviderThreadUsage({
          ...projection,
          providerThreads: [
            {
              ...projection.providerThreads[0]!,
              lastRunOrdinal: 2,
              nativeMetadata: { modelSelection: nextModelSelection },
            },
          ],
          runs: [
            ...projection.runs,
            {
              ...projection.runs[0]!,
              id: RunId.make("unstarted-model-switch"),
              ordinal: 2,
              modelSelection: nextModelSelection,
              status,
              startedAt: null,
            },
          ],
        }),
      ).toEqual({ usage, allowFallback: true, modelSelection });
    },
  );

  it.each(["starting", "failed"] as const)(
    "does not identify unmeasured fallback using setup metadata from a %s run",
    (status) => {
      const projection = makeProjection();
      const nextModelSelection = { ...modelSelection, model: "smaller-model" };
      expect(
        selectActiveProviderThreadUsage({
          ...projection,
          providerTurns: [],
          providerThreads: [
            {
              ...projection.providerThreads[0]!,
              lastRunOrdinal: 2,
              nativeMetadata: { modelSelection: nextModelSelection },
            },
          ],
          runs: [
            ...projection.runs,
            {
              ...projection.runs[0]!,
              id: RunId.make("unstarted-model-switch"),
              ordinal: 2,
              modelSelection: nextModelSelection,
              status,
              startedAt: null,
            },
          ],
        }),
      ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
    },
  );

  it("does not infer fallback ownership from native metadata when the latest run is missing", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerTurns: [],
        providerThreads: [
          {
            ...projection.providerThreads[0]!,
            lastRunOrdinal: 2,
            nativeMetadata: { modelSelection: { ...modelSelection, model: "smaller-model" } },
          },
        ],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
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
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
  });

  it("identifies retained context by its owning run, not a newer native model report", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerThreads: [
          {
            ...projection.providerThreads[0]!,
            nativeMetadata: { modelSelection: { ...modelSelection, model: "different-model" } },
          },
        ],
      }),
    ).toEqual({ usage, allowFallback: true, modelSelection });
  });

  it("identifies imported provider-thread fallback from its native model report", () => {
    const projection = makeProjection();
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        providerThreads: [
          {
            ...projection.providerThreads[0]!,
            lastRunOrdinal: null,
            nativeMetadata: { modelSelection },
          },
        ],
        providerTurns: [],
        attempts: [],
        runs: [],
      }),
    ).toEqual({ usage: null, allowFallback: true, modelSelection });
  });

  it("keeps runless source identity unavailable without a matching provider model report", () => {
    const projection = makeProjection();
    for (const nativeMetadata of [
      null,
      {
        modelSelection: {
          ...modelSelection,
          instanceId: ProviderInstanceId.make("other-account"),
        },
      },
    ]) {
      expect(
        selectActiveProviderThreadUsage({
          ...projection,
          providerThreads: [{ ...projection.providerThreads[0]!, nativeMetadata }],
          providerTurns: [{ ...projection.providerTurns[0]!, runAttemptId: null }],
        }),
      ).toEqual({ usage, allowFallback: true, modelSelection: null });
    }
  });

  it("rejects a report whose attempt or owning model belongs to another account", () => {
    const projection = makeProjection();
    const otherInstanceId = ProviderInstanceId.make("other-account");
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        attempts: [{ ...projection.attempts[0]!, providerInstanceId: otherInstanceId }],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
    expect(
      selectActiveProviderThreadUsage({
        ...projection,
        runs: [
          {
            ...projection.runs[0]!,
            modelSelection: { ...modelSelection, instanceId: otherInstanceId },
          },
        ],
      }),
    ).toEqual({ usage: null, allowFallback: false, modelSelection: null });
  });
});

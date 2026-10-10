import { ProviderInstanceId, ProviderThreadId, RunAttemptId, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveLatestTurnThroughput } from "./turnThroughput";

type Projection = NonNullable<Parameters<typeof deriveLatestTurnThroughput>[0]>;
const providerInstanceId = ProviderInstanceId.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread");
const attemptId = RunAttemptId.make("attempt");
const runId = RunId.make("run");
const startedAt = DateTime.makeUnsafe("2026-10-10T12:00:00.000Z");
const completedAt = DateTime.makeUnsafe("2026-10-10T12:00:10.000Z");

function makeProjection(overrides: Partial<Projection> = {}): Projection {
  return {
    thread: { activeProviderThreadId: providerThreadId },
    providerThreads: [{ id: providerThreadId, providerInstanceId }],
    providerTurns: [
      {
        providerThreadId,
        runAttemptId: attemptId,
        ordinal: 1,
        status: "completed",
        startedAt,
        completedAt,
        turnTokenUsage: {
          usageScope: "main_agent",
          usageStatus: "complete",
          hasSubagents: true,
          inputTokens: 20_000,
          outputTokens: 250,
          reasoningTokens: 100,
        },
      },
    ],
    attempts: [
      {
        id: attemptId,
        runId,
        providerThreadId,
        providerInstanceId,
        status: "completed",
      },
    ],
    runs: [{ id: runId, ordinal: 1, activeAttemptId: attemptId, status: "completed" }],
    ...overrides,
  };
}

function withTurn(overrides: Partial<Projection["providerTurns"][number]>): Projection {
  const projection = makeProjection();
  return { ...projection, providerTurns: [{ ...projection.providerTurns[0]!, ...overrides }] };
}

describe("completed-turn throughput", () => {
  it("uses complete output totals including reasoning across the whole turn", () => {
    expect(deriveLatestTurnThroughput(makeProjection())).toEqual({
      providerInstanceId,
      outputTokens: 250,
      durationMs: 10_000,
      tokensPerSecond: 25,
    });
  });

  it("preserves a reported zero and leaves rounding to the presentation", () => {
    const projection = makeProjection();
    const usage = projection.providerTurns[0]!.turnTokenUsage!;
    expect(
      deriveLatestTurnThroughput(withTurn({ turnTokenUsage: { ...usage, outputTokens: 0 } }))
        ?.tokensPerSecond,
    ).toBe(0);
    expect(
      deriveLatestTurnThroughput(withTurn({ turnTokenUsage: { ...usage, outputTokens: 1 } }))
        ?.tokensPerSecond,
    ).toBe(0.1);
  });

  it("returns no rate without a projection or active provider thread", () => {
    expect(deriveLatestTurnThroughput(null)).toBeNull();
    expect(
      deriveLatestTurnThroughput(makeProjection({ thread: { activeProviderThreadId: null } })),
    ).toBeNull();
    expect(deriveLatestTurnThroughput(makeProjection({ providerThreads: [] }))).toBeNull();
    expect(deriveLatestTurnThroughput(makeProjection({ providerTurns: [] }))).toBeNull();
  });

  it("selects the greatest ordinal only within the active provider thread", () => {
    const projection = makeProjection();
    const turn = projection.providerTurns[0]!;
    expect(
      deriveLatestTurnThroughput({
        ...projection,
        providerTurns: [
          { ...turn, ordinal: 3 },
          { ...turn, ordinal: 1, status: "failed" },
          { ...turn, providerThreadId: ProviderThreadId.make("other"), ordinal: 99 },
        ],
      })?.tokensPerSecond,
    ).toBe(25);
  });

  it.each(["pending", "running", "interrupted", "failed", "cancelled"] as const)(
    "does not reuse an older rate when the latest turn is %s",
    (status) => {
      const projection = makeProjection();
      expect(
        deriveLatestTurnThroughput({
          ...projection,
          providerTurns: [
            { ...projection.providerTurns[0]!, ordinal: 2, status },
            projection.providerTurns[0]!,
          ],
        }),
      ).toBeNull();
    },
  );

  it("does not substitute context or partial usage for complete turn totals", () => {
    const projection = makeProjection();
    const turnWithContext = {
      ...projection.providerTurns[0]!,
      turnTokenUsage: undefined,
      tokenUsage: { usedTokens: 20_000, outputTokens: 250, updatedAt: "2026-10-10T12:00:10Z" },
    };
    expect(
      deriveLatestTurnThroughput({ ...projection, providerTurns: [turnWithContext] }),
    ).toBeNull();
    for (const usageStatus of ["partial", "unavailable"] as const) {
      expect(
        deriveLatestTurnThroughput(
          withTurn({
            turnTokenUsage: {
              usageScope: "main_agent",
              usageStatus,
              hasSubagents: false,
              outputTokens: 250,
            },
          }),
        ),
      ).toBeNull();
    }
  });

  it("requires timestamps and a positive elapsed duration", () => {
    expect(deriveLatestTurnThroughput(withTurn({ startedAt: null }))).toBeNull();
    expect(deriveLatestTurnThroughput(withTurn({ completedAt: null }))).toBeNull();
    expect(deriveLatestTurnThroughput(withTurn({ completedAt: startedAt }))).toBeNull();
    expect(
      deriveLatestTurnThroughput(withTurn({ startedAt: completedAt, completedAt: startedAt })),
    ).toBeNull();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid output totals: %s",
    (outputTokens) => {
      const usage = makeProjection().providerTurns[0]!.turnTokenUsage!;
      expect(
        deriveLatestTurnThroughput(withTurn({ turnTokenUsage: { ...usage, outputTokens } })),
      ).toBeNull();
    },
  );

  it("requires a current, completed owning run and attempt", () => {
    const projection = makeProjection();
    expect(deriveLatestTurnThroughput(makeProjection({ attempts: [] }))).toBeNull();
    expect(deriveLatestTurnThroughput(makeProjection({ runs: [] }))).toBeNull();
    expect(deriveLatestTurnThroughput(withTurn({ runAttemptId: null }))).toBeNull();
    expect(
      deriveLatestTurnThroughput({
        ...projection,
        attempts: [{ ...projection.attempts[0]!, status: "superseded" }],
      }),
    ).toBeNull();
    expect(
      deriveLatestTurnThroughput({
        ...projection,
        runs: [{ ...projection.runs[0]!, activeAttemptId: RunAttemptId.make("replacement") }],
      }),
    ).toBeNull();
    expect(
      deriveLatestTurnThroughput({
        ...projection,
        attempts: [
          { ...projection.attempts[0]!, providerInstanceId: ProviderInstanceId.make("other") },
        ],
      }),
    ).toBeNull();
  });

  it.each(["queued", "running", "failed", "cancelled", "rolled_back"] as const)(
    "hides the rate after the current run becomes %s",
    (status) => {
      const projection = makeProjection();
      expect(
        deriveLatestTurnThroughput({
          ...projection,
          runs: [{ ...projection.runs[0]!, status }],
        }),
      ).toBeNull();
    },
  );

  it("does not show an older rate for a new run before its provider turn arrives", () => {
    const projection = makeProjection();
    expect(
      deriveLatestTurnThroughput({
        ...projection,
        runs: [
          { id: RunId.make("new-run"), ordinal: 2, activeAttemptId: null, status: "queued" },
          ...projection.runs,
        ],
      }),
    ).toBeNull();
  });

  it("does not resurrect a completed turn from rewound history", () => {
    const projection = makeProjection();
    const rolledBackRunId = RunId.make("rolled-back");
    const rolledBackAttemptId = RunAttemptId.make("rolled-back-attempt");
    expect(
      deriveLatestTurnThroughput({
        ...projection,
        providerTurns: [
          ...projection.providerTurns,
          { ...projection.providerTurns[0]!, ordinal: 2, runAttemptId: rolledBackAttemptId },
        ],
        attempts: [
          ...projection.attempts,
          { ...projection.attempts[0]!, id: rolledBackAttemptId, runId: rolledBackRunId },
        ],
        runs: [
          ...projection.runs,
          {
            id: rolledBackRunId,
            ordinal: 2,
            activeAttemptId: rolledBackAttemptId,
            status: "rolled_back",
          },
        ],
      }),
    ).toBeNull();
  });
});

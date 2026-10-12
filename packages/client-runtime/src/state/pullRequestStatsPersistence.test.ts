import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, type PullRequestRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { EnvironmentQueryStore } from "./queryPersistence.ts";
import { persistPullRequestStats } from "./pullRequestStatsPersistence.ts";

const environmentId = EnvironmentId.make("env");
const personal: PullRequestRef = {
  projectId: ProjectId.make("project"),
  host: "github.com",
  repository: "org/repo",
  number: 1,
  expectedAccountId: "101",
};
const work = { ...personal, expectedAccountId: "202" };
const stats = (additions: number) => ({
  projectId: personal.projectId,
  repository: personal.repository,
  number: personal.number,
  additions,
  deletions: 1,
});
const key = (...refs: PullRequestRef[]) => JSON.stringify(["stats", { refs }]);
function memoryStore() {
  const values = new Map<string, string>();
  return {
    load: (env: EnvironmentId, request: string) =>
      Effect.sync(() => Option.fromUndefinedOr(values.get(`${env}:${request}`))),
    save: (env: EnvironmentId, request: string, payload: string) =>
      Effect.sync(() => {
        values.set(`${env}:${request}`, payload);
      }),
  };
}

describe("account-scoped PR stat persistence", () => {
  it.effect("reloads independent account counts after rebatching and restarting", () =>
    Effect.gen(function* () {
      const cache = persistPullRequestStats();
      yield* cache.save(environmentId, key(personal, { ...personal, number: 2 }), {
        stats: [stats(10)],
      });
      yield* cache.save(environmentId, key(work), { stats: [stats(90)] });
      const reloaded = persistPullRequestStats();
      expect(yield* reloaded.load(environmentId, key(personal))).toEqual(
        Option.some({ stats: [stats(10)] }),
      );
      expect(yield* reloaded.load(environmentId, key(work))).toEqual(
        Option.some({ stats: [stats(90)] }),
      );
      expect(
        yield* reloaded.load(environmentId, key({ ...personal, host: "enterprise.test" })),
      ).toEqual(Option.none());
      expect(
        yield* reloaded.load(
          environmentId,
          key({ ...personal, projectId: ProjectId.make("other") }),
        ),
      ).toEqual(Option.none());
      expect(yield* reloaded.load(EnvironmentId.make("other"), key(personal))).toEqual(
        Option.none(),
      );
    }).pipe(Effect.provideService(EnvironmentQueryStore, memoryStore())),
  );
  it.effect("matches verified account and host identities in one batch before persisting", () =>
    Effect.gen(function* () {
      const cache = persistPullRequestStats();
      const enterprise = { ...personal, host: "enterprise.test" };
      const personalStat = {
        ...stats(10),
        host: personal.host,
        expectedAccountId: personal.expectedAccountId,
      };
      const workStat = { ...stats(90), host: work.host, expectedAccountId: work.expectedAccountId };
      const enterpriseStat = {
        ...stats(50),
        host: enterprise.host,
        expectedAccountId: enterprise.expectedAccountId,
      };
      yield* cache.save(environmentId, key(personal, work, enterprise), {
        stats: [workStat, enterpriseStat, personalStat],
      });
      const reloaded = persistPullRequestStats();
      expect(yield* reloaded.load(environmentId, key(personal))).toEqual(
        Option.some({ stats: [personalStat] }),
      );
      expect(yield* reloaded.load(environmentId, key(work))).toEqual(
        Option.some({ stats: [workStat] }),
      );
      expect(yield* reloaded.load(environmentId, key(enterprise))).toEqual(
        Option.some({ stats: [enterpriseStat] }),
      );
      yield* cache.save(environmentId, key(work), { stats: [personalStat] });
      expect(yield* reloaded.load(environmentId, key(work))).toEqual(
        Option.some({ stats: [workStat] }),
      );
    }).pipe(Effect.provideService(EnvironmentQueryStore, memoryStore())),
  );
  it.effect(
    "refuses ambiguous results lacking account or host instead of saving under the first ref",
    () =>
      Effect.gen(function* () {
        const cache = persistPullRequestStats();
        yield* cache.save(environmentId, key(personal, work), { stats: [stats(10), stats(90)] });
        yield* cache.save(environmentId, key(personal, { ...personal, host: "enterprise.test" }), {
          stats: [stats(20)],
        });
        expect(yield* cache.load(environmentId, key(personal))).toEqual(Option.none());
        expect(yield* cache.load(environmentId, key(work))).toEqual(Option.none());
      }).pipe(Effect.provideService(EnvironmentQueryStore, memoryStore())),
  );
  it.effect(
    "treats repeated identical refs as one identity and preserves legacy unguarded reads",
    () =>
      Effect.gen(function* () {
        const cache = persistPullRequestStats();
        const legacy = {
          projectId: personal.projectId,
          repository: personal.repository,
          number: personal.number,
        };
        yield* cache.save(environmentId, key(legacy, legacy), { stats: [stats(10)] });
        expect(yield* cache.load(environmentId, key(legacy))).toEqual(
          Option.some({ stats: [stats(10)] }),
        );
        expect(yield* cache.load(environmentId, key(personal))).toEqual(Option.none());
      }).pipe(Effect.provideService(EnvironmentQueryStore, memoryStore())),
  );
});

import {
  PullRequestDiffStat,
  PullRequestListStatsInput,
  type PullRequestListStatsResult,
  type PullRequestRef,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { persistQuery, type QueryPersistence } from "./queryPersistence.ts";

const requestKey = Schema.fromJsonString(Schema.Tuple([Schema.String, PullRequestListStatsInput]));
const statKey = (ref: PullRequestRef) =>
  JSON.stringify([
    "pull-request-stat",
    ref.projectId,
    ref.host?.toLowerCase() ?? "",
    ref.repository.toLowerCase(),
    ref.number,
    ...(ref.expectedAccountId ? [ref.expectedAccountId] : []),
  ]);

const matchesStat = (ref: PullRequestRef, stat: PullRequestDiffStat) =>
  ref.projectId === stat.projectId &&
  ref.repository.toLowerCase() === stat.repository.toLowerCase() &&
  ref.number === stat.number &&
  (stat.host === undefined ||
    ref.host === undefined ||
    stat.host.toLowerCase() === ref.host.toLowerCase()) &&
  (stat.expectedAccountId === undefined ||
    ref.expectedAccountId === undefined ||
    stat.expectedAccountId === ref.expectedAccountId);

export function persistPullRequestStats(): QueryPersistence<PullRequestListStatsResult> {
  const row = persistQuery(PullRequestDiffStat);
  return {
    load: (environmentId, key) =>
      Effect.gen(function* () {
        const [, input] = yield* Schema.decodeEffect(requestKey)(key);
        const rows = yield* Effect.forEach(input.refs, (ref) =>
          row
            .load(environmentId, statKey(ref))
            .pipe(Effect.map((value) => Option.filter(value, (stat) => matchesStat(ref, stat)))),
        );
        const stats = rows.flatMap((value) => (Option.isSome(value) ? [value.value] : []));
        return stats.length ? Option.some({ stats }) : Option.none();
      }).pipe(Effect.orElseSucceed(() => Option.none())),
    save: (environmentId, key, result) =>
      Effect.gen(function* () {
        const [, input] = yield* Schema.decodeEffect(requestKey)(key);
        yield* Effect.forEach(result.stats, (stat) => {
          const refs = input.refs.filter((ref) => matchesStat(ref, stat));
          // Older responses omit host/account. Never attach an ambiguous result to the first
          // matching ref: it may belong to another account or another server on the same host.
          const keys = new Set(refs.map(statKey));
          const ref = refs[0];
          return ref && keys.size === 1 ? row.save(environmentId, statKey(ref), stat) : Effect.void;
        });
      }).pipe(Effect.ignore),
  };
}

import { useAtomValue } from "@effect/atom-react";
import { FORK_REPOSITORY } from "@t3tools/shared/forkIdentity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

const Release = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  assets: Schema.Array(
    Schema.Struct({ name: Schema.String, size: Schema.Number, state: Schema.String }),
  ),
});

export type CliReleaseAvailability =
  | { readonly status: "checking" }
  | { readonly status: "unavailable" }
  | { readonly status: "error" }
  | { readonly status: "available"; readonly assets: ReadonlyArray<string> };

export const cliReleaseAvailabilityAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      // The fork self-updater installs GitHub archives even for npm-launched servers.
      const response = yield* HttpClient.get(
        `https://api.github.com/repos/${FORK_REPOSITORY}/releases/tags/${encodeURIComponent(`v${version}`)}`,
      );
      if (response.status === 404) return { status: "unavailable" } as const;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Release)),
      );
      if (body.draft || body.tag_name !== `v${version}`) return { status: "unavailable" } as const;
      return {
        status: "available",
        assets: body.assets
          .filter((asset) => asset.state === "uploaded" && asset.size > 0)
          .map((asset) => asset.name),
      } as const;
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`cli-release-availability:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success({ status: "unavailable" } as const));

export function useCliReleaseAvailability(version: string | null): CliReleaseAvailability {
  const result = useAtomValue(version ? cliReleaseAvailabilityAtom(version) : NO_VERSION_ATOM);
  if (AsyncResult.isInitial(result) || result.waiting) return { status: "checking" };
  if (AsyncResult.isFailure(result)) return { status: "error" };
  return result.value;
}

import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { findEnvironmentUpdate } from "./environment-maintenance";

export interface EnvironmentReleaseCheck {
  readonly sourceKey: string;
  readonly fromVersion: string;
  readonly targetVersion: string | null;
}

const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error("Could not check for updates.");

/**
 * Looks up the newest T3 Code release for one environment. The atom is not
 * kept alive, so leaving the screen interrupts the lookup and aborts its fetch.
 * The argument reads the release identity, which an outdated server only
 * reports through a separate description request.
 */
export function environmentReleaseSourceKey(
  environment: Parameters<typeof findEnvironmentUpdate>[0],
) {
  return JSON.stringify([
    environment.serverVersion,
    environment.release,
    environment.capabilities?.serverSelfUpdate,
  ]);
}

export const environmentReleaseCheckAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.fn((readEnvironment: () => Promise<Parameters<typeof findEnvironmentUpdate>[0]>) =>
    Effect.gen(function* () {
      const environment = yield* Effect.tryPromise({ try: readEnvironment, catch: asError });
      const fromVersion = environment.serverVersion;
      const targetVersion = yield* Effect.tryPromise({
        try: (signal) => findEnvironmentUpdate(environment, signal),
        catch: asError,
      }).pipe(
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.fail(new Error("Checking for updates timed out. Try again.")),
        }),
      );
      return {
        sourceKey: environmentReleaseSourceKey(environment),
        fromVersion,
        targetVersion,
      } satisfies EnvironmentReleaseCheck;
    }),
  ).pipe(Atom.withLabel(`mobile:environment-release-check:${environmentId}`)),
);

export function releaseCheckValue(
  result: AsyncResult.AsyncResult<EnvironmentReleaseCheck, Error>,
): EnvironmentReleaseCheck | null {
  return AsyncResult.getOrElse(result, () => null);
}

export function releaseCheckError(
  result: AsyncResult.AsyncResult<EnvironmentReleaseCheck, Error>,
): string | null {
  if (!AsyncResult.isFailure(result) || result.waiting) return null;
  return Option.getOrNull(AsyncResult.error(result))?.message ?? null;
}

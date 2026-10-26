import {
  createPullRequestEnvironmentAtoms,
  createPullRequestStackAtomFamily,
} from "@t3tools/client-runtime/state/pull-requests";
import type { EnvironmentId, PullRequestListInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";
import {
  pullRequestListHead,
  type PullRequestListPages,
} from "../features/pull-requests/pullRequestList";

export const pullRequestListPagesKey = (target: {
  readonly environmentId: EnvironmentId;
  readonly input: PullRequestListInput;
}) => JSON.stringify([target.environmentId, target.input]);

/** The pages loaded past each listing's head, keyed by {@link pullRequestListPagesKey}. */
export const pullRequestListPagesFamily = Atom.family((_key: string) =>
  Atom.make<PullRequestListPages | null>(null).pipe(Atom.setIdleTTL(5 * 60_000)),
);

export const composerPullRequests = createPullRequestEnvironmentAtoms(connectionAtomRuntime, {
  list: (target, value, registry) =>
    target.input.cursors === undefined
      ? Effect.sync(() =>
          registry.update(pullRequestListPagesFamily(pullRequestListPagesKey(target)), (previous) =>
            pullRequestListHead(previous, value),
          ),
        )
      : Effect.void,
});
export const pullRequestStackAtom = createPullRequestStackAtomFamily(
  connectionAtomRuntime,
  composerPullRequests.refreshes,
);

import type { EnvironmentId } from "@t3tools/contracts";

import { ReviewDiffButton } from "./diffViewer/ReviewDiffButton";

/**
 * Fork-local seam rendered inside the base `ChatHeader` action group.
 *
 * Keeping the integration to a single component import keeps the base header
 * untouched apart from one render call, so upstream merges stay low-risk.
 */
export function ForkChatHeaderActions({
  environmentId,
  cwd,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
}) {
  if (!cwd) return null;
  return <ReviewDiffButton environmentId={environmentId} cwd={cwd} />;
}

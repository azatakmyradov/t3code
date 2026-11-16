import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";

import {
  composerDraftHasUserContent,
  type DraftId,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { seedDraftModelSelection } from "~/lib/seedDraftModelSelection";
import { useNewThreadHandler } from "./useHandleNewThread";

/** Retarget an unsent draft without moving its composer content. */
export function useSelectDraftProject(draftId: DraftId | null) {
  const openProjectDraft = useNewThreadHandler();
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);

  return (project: EnvironmentProject, logicalProjectKey: string) => {
    if (!draftId) return;
    const session = getDraftSession(draftId);
    if (!session || session.promotedTo) return;
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    // Empty drafts open the destination's draft so its saved browser tabs
    // and other context aren't stranded by remapping an unrelated draft.
    if (!composerDraftHasUserContent(getComposerDraft(draftId))) {
      void openProjectDraft(projectRef);
      return;
    }
    setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId);
    seedDraftModelSelection(draftId, projectRef);
  };
}

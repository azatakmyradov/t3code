import { useCallback } from "react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import {
  composerDraftHasUserContent,
  type DraftId,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { useNewThreadHandler } from "./useHandleNewThread";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { useEnvironments } from "~/state/environments";

/** Retarget an unsent draft without moving its composer content. */
export function useSelectDraftProject(draftId: DraftId | null) {
  const { environments } = useEnvironments();
  const openProjectDraft = useNewThreadHandler();
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);

  return useCallback(
    (project: EnvironmentProject, logicalProjectKey: string, exactFolder = false) => {
      if (!draftId) return;
      const session = getDraftSession(draftId);
      if (!session || session.promotedTo) return;
      const currentDraft = getComposerDraft(draftId);
      // Empty drafts open the destination's draft so its saved browser tabs
      // and other context aren't stranded by remapping an unrelated draft.
      if (!composerDraftHasUserContent(currentDraft)) {
        void openProjectDraft(
          scopeProjectRef(project.environmentId, project.id),
          exactFolder ? { environmentSelection: "manual" } : undefined,
        );
        return;
      }
      setLogicalProjectDraftThreadId(
        logicalProjectKey,
        scopeProjectRef(project.environmentId, project.id),
        draftId,
        exactFolder
          ? { environmentSelection: "manual", loadBalancedEnvironmentId: null }
          : undefined,
      );
      if (!hasExplicitComposerModelSelection(currentDraft)) {
        applyStickyState(draftId);
        const environmentSettings = environments.find(
          (environment) => environment.environmentId === project.environmentId,
        )?.serverConfig?.settings;
        const defaultModelSelection = environmentSettings
          ? resolveProjectSettings(environmentSettings, project.id, project).settings
              .defaultModelSelection
          : project.defaultModelSelection;
        if (defaultModelSelection) {
          setModelSelection(draftId, defaultModelSelection, { replaceOptions: true });
        }
      }
    },
    [
      applyStickyState,
      draftId,
      environments,
      getComposerDraft,
      getDraftSession,
      openProjectDraft,
      setLogicalProjectDraftThreadId,
      setModelSelection,
    ],
  );
}

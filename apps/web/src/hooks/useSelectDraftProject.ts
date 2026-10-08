import { useCallback } from "react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { useEnvironments } from "~/state/environments";

/** Retarget an unsent draft without moving its composer content. */
export function useSelectDraftProject(draftId: DraftId | null) {
  const { environments } = useEnvironments();
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
      setLogicalProjectDraftThreadId,
      setModelSelection,
    ],
  );
}

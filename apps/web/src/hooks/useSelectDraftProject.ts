import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";

import {
  composerDraftHasUserContent,
  type DraftId,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { useNewThreadHandler } from "./useHandleNewThread";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { useEnvironmentProviders, useEnvironments } from "~/state/environments";

/** Retarget an unsent draft without moving its composer content. */
export function useSelectDraftProject(draftId: DraftId | null) {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const openProjectDraft = useNewThreadHandler();
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);

  return (project: EnvironmentProject, logicalProjectKey: string) => {
    if (!draftId) return;
    const session = getDraftSession(draftId);
    if (!session || session.promotedTo) return;
    const currentDraft = getComposerDraft(draftId);
    // Empty drafts open the destination's draft so its saved browser tabs
    // and other context aren't stranded by remapping an unrelated draft.
    if (!composerDraftHasUserContent(currentDraft)) {
      void openProjectDraft(scopeProjectRef(project.environmentId, project.id));
      return;
    }
    setLogicalProjectDraftThreadId(
      logicalProjectKey,
      scopeProjectRef(project.environmentId, project.id),
      draftId,
    );
    if (!hasExplicitComposerModelSelection(currentDraft)) {
      applyStickyState(draftId);
      const environmentSettings = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig?.settings;
      const defaultSelection = environmentSettings
        ? resolveProjectSettings(environmentSettings, project.id, project).settings
            .defaultModelSelection
        : project.defaultModelSelection;
      const providers = providersByEnvironment.get(project.environmentId) ?? [];
      const fallbackResolution = resolveNewThreadModelSelection({
        defaultSelection:
          defaultSelection ??
          (useComposerDraftStore.getState().stickyActiveProvider !== null || !environmentSettings
            ? null
            : resolveProjectDefaultProviderModelSelection(
                providers,
                environmentSettings,
                project.id,
              )),
        fallbackSelection: environmentSettings?.fallbackModelSelection ?? null,
        providers,
        ...(environmentSettings ? { settings: environmentSettings } : {}),
        projectId: project.id,
        now: Date.now(),
      });
      const defaultModelSelection = fallbackResolution.fallback
        ? fallbackResolution.selection
        : defaultSelection;
      if (defaultModelSelection) {
        setModelSelection(draftId, defaultModelSelection, { replaceOptions: true });
      }
    }
  };
}

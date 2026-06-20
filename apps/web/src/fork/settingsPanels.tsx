import { useAtomValue } from "@effect/atom-react";
import type { ModelSelection } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";

import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { SettingsRow, SettingResetButton } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";
import { usePrimarySettings, useUpdatePrimarySettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance, resolveAppModelSelectionState } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { primaryServerProvidersAtom } from "../state/server";
import { getForkBuilderModelSelectionStatus } from "./builderImplementation";

function ForkReviewGroupsDefaultModeRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsRow
      title="Semantic groups by default"
      description="When AI groups exist for a diff, open the review viewer in semantic groups instead of the file tree."
      resetAction={
        settings.fork.reviewGroupsDefaultMode !==
        DEFAULT_UNIFIED_SETTINGS.fork.reviewGroupsDefaultMode ? (
          <SettingResetButton
            label="semantic groups default"
            onClick={() =>
              updateSettings({
                fork: {
                  ...settings.fork,
                  reviewGroupsDefaultMode: DEFAULT_UNIFIED_SETTINGS.fork.reviewGroupsDefaultMode,
                },
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.fork.reviewGroupsDefaultMode === "groups"}
          onCheckedChange={(checked) =>
            updateSettings({
              fork: {
                ...settings.fork,
                reviewGroupsDefaultMode: checked ? "groups" : "files",
              },
            })
          }
          aria-label="Open review diffs in semantic groups when groups exist"
        />
      }
    />
  );
}

/**
 * Dedicated model picker for the AI semantic-diff-groups review aid. When the
 * override is off the grouping inherits the global text-generation model; when
 * on it uses its own provider/model (resolved/validated the same way the base
 * "Text generation model" row resolves its selection).
 */
function ForkReviewGroupsModelRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);

  const override = settings.fork.reviewGroupsModelSelection;
  const overrideEnabled = override !== null;

  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  // Resolve against providers so a disabled/removed instance falls back to a
  // valid one for display, exactly like the base text-generation row.
  const effective = resolveAppModelSelectionState(
    overrideEnabled ? { ...settings, textGenerationModelSelection: override } : settings,
    serverProviders,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(settings, serverProviders);

  const setOverride = (selection: ModelSelection | null) =>
    updateSettings({ fork: { ...settings.fork, reviewGroupsModelSelection: selection } });

  return (
    <SettingsRow
      title="Semantic group model"
      description="Model used for AI semantic diff grouping in the review viewer. Off uses the text generation model."
      resetAction={
        overrideEnabled ? (
          <SettingResetButton label="semantic group model" onClick={() => setOverride(null)} />
        ) : null
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Switch
            checked={overrideEnabled}
            onCheckedChange={(checked) =>
              setOverride(checked ? resolveAppModelSelectionState(settings, serverProviders) : null)
            }
            aria-label="Use a dedicated model for semantic diff grouping"
          />
          {overrideEnabled && (
            <ProviderModelPicker
              activeInstanceId={effective.instanceId}
              model={effective.model}
              lockedProvider={null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onInstanceModelChange={(instanceId, model) =>
                setOverride(
                  resolveAppModelSelectionState(
                    {
                      ...settings,
                      textGenerationModelSelection: createModelSelection(instanceId, model),
                    },
                    serverProviders,
                  ),
                )
              }
            />
          )}
        </div>
      }
    />
  );
}

/**
 * Dedicated model picker for the plan follow-up "Implement with builder"
 * action. When the override is off the action is hidden; when on, the action
 * uses this exact provider/model if it is still resolvable.
 */
function ForkBuilderModelRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);

  const builderSelection = settings.fork.builderModelSelection;
  const builderEnabled = builderSelection !== null;

  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const effective = resolveAppModelSelectionState(
    builderEnabled ? { ...settings, textGenerationModelSelection: builderSelection } : settings,
    serverProviders,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(settings, serverProviders);
  const builderStatus = getForkBuilderModelSelectionStatus(settings, serverProviders);

  const setBuilderSelection = (selection: ModelSelection | null) =>
    updateSettings({ fork: { ...settings.fork, builderModelSelection: selection } });

  return (
    <SettingsRow
      title="Builder model"
      description="Model used by the plan follow-up action that implements the plan in a new thread. Off hides that action."
      status={
        builderStatus ? (
          <span className="text-amber-600 dark:text-amber-400">{builderStatus}</span>
        ) : null
      }
      resetAction={
        builderEnabled ? (
          <SettingResetButton label="builder model" onClick={() => setBuilderSelection(null)} />
        ) : null
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Switch
            checked={builderEnabled}
            onCheckedChange={(checked) =>
              setBuilderSelection(
                checked ? resolveAppModelSelectionState(settings, serverProviders) : null,
              )
            }
            aria-label="Use a dedicated builder model for plan implementation"
          />
          {builderEnabled && (
            <ProviderModelPicker
              activeInstanceId={effective.instanceId}
              model={effective.model}
              lockedProvider={null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onInstanceModelChange={(instanceId, model) =>
                setBuilderSelection(
                  resolveAppModelSelectionState(
                    {
                      ...settings,
                      textGenerationModelSelection: createModelSelection(instanceId, model),
                    },
                    serverProviders,
                  ),
                )
              }
            />
          )}
        </div>
      }
    />
  );
}

function ForkAgentNotificationsRow() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);

  if (!hasDesktopBridge) return null;

  return (
    <SettingsRow
      title="Agent completion notifications"
      description="Show desktop notifications when an agent finishes or fails outside the focused thread."
      resetAction={
        settings.fork.desktopAgentTerminalNotificationsEnabled !==
        DEFAULT_UNIFIED_SETTINGS.fork.desktopAgentTerminalNotificationsEnabled ? (
          <SettingResetButton
            label="agent completion notifications"
            onClick={() =>
              updateSettings({
                fork: {
                  ...settings.fork,
                  desktopAgentTerminalNotificationsEnabled:
                    DEFAULT_UNIFIED_SETTINGS.fork.desktopAgentTerminalNotificationsEnabled,
                },
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.fork.desktopAgentTerminalNotificationsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({
              fork: {
                ...settings.fork,
                desktopAgentTerminalNotificationsEnabled: Boolean(checked),
              },
            })
          }
          aria-label="Show agent completion desktop notifications"
        />
      }
    />
  );
}

export function ForkGeneralSettingsRows() {
  return (
    <>
      <ForkReviewGroupsDefaultModeRow />
      <ForkBuilderModelRow />
      <ForkReviewGroupsModelRow />
      <ForkAgentNotificationsRow />
    </>
  );
}

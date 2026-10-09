import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { useMemo } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";

/** Provider instances an environment offers, with the user's instance settings applied. */
export function useProviderEntries(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  return { settings, providers, entries };
}

/** Provider, model, and trait pickers for a bot's model outside the composer. */
export function BotModelPicker({
  environmentId,
  selection,
  onChange,
}: {
  environmentId: EnvironmentId;
  selection: ModelSelection;
  onChange: (selection: ModelSelection) => void;
}) {
  const { settings, providers, entries } = useProviderEntries(environmentId);
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(settings, providers, selection.instanceId, selection.model),
    [settings, providers, selection.instanceId, selection.model],
  );
  const entry = entries.find((entry) => entry.instanceId === selection.instanceId);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <ProviderModelPicker
        instanceEntries={entries}
        modelOptionsByInstance={modelOptionsByInstance}
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        onInstanceModelChange={(instanceId, model) => onChange({ instanceId, model })}
        isComposerOwned={false}
      />
      {entry && (
        <TraitsPicker
          provider={entry.driverKind}
          instanceId={entry.instanceId}
          models={entry.models}
          model={selection.model}
          prompt=""
          onPromptChange={() => {}}
          modelOptions={selection.options ?? []}
          allowPromptInjectedEffort={false}
          planModeEnabled={settings.planModeEnabled}
          isComposerOwned={false}
          onModelOptionsChange={(options) =>
            onChange({
              instanceId: selection.instanceId,
              model: selection.model,
              ...(options ? { options } : {}),
            })
          }
        />
      )}
    </div>
  );
}

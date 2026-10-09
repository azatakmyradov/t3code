import { useAtomValue } from "@effect/atom-react";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { BotPermissions, BotProfile, EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { ControlPill } from "../../components/ControlPill";
import { ErrorBanner } from "../../components/ErrorBanner";
import { buildModelOptions } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { BotModelRow, BotSection, BotTextField } from "./BotFormRows";
import { BotProjectPicker } from "./BotProjectPicker";
import { BotRemoteAccess } from "./BotRemoteAccess";
import { useBotOperation } from "./useBotOperation";

const DEFAULT_PERMISSIONS: BotPermissions = {
  runtimeMode: "approval-required",
  allowDelegation: true,
  allowBotRequests: true,
  projects: [],
};

/** Blank turns check-ins off; `undefined` means the value is out of range. */
function parseCheckInMinutes(value: string) {
  if (!value.trim()) return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080 ? minutes : undefined;
}

/** Creates a bot, or edits its profile and memory when `bot` is set. */
export function BotEditor({
  environmentId,
  bot,
  onDone,
  onCancel,
}: {
  environmentId: EnvironmentId;
  bot: BotProfile | null;
  onDone: (bot: BotProfile) => void;
  onCancel: () => void;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const models = useMemo(
    () => buildModelOptions(config, bot?.modelSelection ?? null),
    [config, bot?.modelSelection],
  );
  const [selection, setSelection] = useState<ModelSelection | null>(bot?.modelSelection ?? null);
  const model =
    selection ??
    models.find((option) => option.isDefault && !option.isUnavailable)?.selection ??
    models.find((option) => !option.isUnavailable)?.selection ??
    null;
  const [name, setName] = useState(bot?.name ?? "");
  const [permissions, setPermissions] = useState(bot?.permissions ?? DEFAULT_PERMISSIONS);
  const [instructions, setInstructions] = useState(bot?.instructions ?? "");
  const [memory, setMemory] = useState(bot?.memory ?? "");
  const [minutes, setMinutes] = useState(() => bot?.checkInMinutes?.toString() ?? "");
  const [createRequestId] = useState(uuidv4);
  // Saving takes up to three commands. Keep the latest saved profile so a retry
  // after a partial failure updates it instead of conflicting or creating twice.
  const saved = useRef(bot);
  const { busy, error, setError, run } = useBotOperation();
  const create = useAtomCommand(serverEnvironment.bots.create);
  const update = useAtomCommand(serverEnvironment.bots.update);
  const write = useAtomCommand(serverEnvironment.bots.writeContext);
  const canSave = useAtomValue(
    serverEnvironment.bots[bot ? "update" : "create"].permissionAtom(environmentId),
  );

  const persist = async (
    modelSelection: ModelSelection,
    checkInMinutes: number | null,
  ): Promise<AtomCommandResult<BotProfile, unknown>> => {
    const existing = saved.current;
    let result: AtomCommandResult<BotProfile, unknown> = existing
      ? await update({
          environmentId,
          input: {
            botId: existing.id,
            expectedRevision: existing.revision,
            name: name.trim(),
            modelSelection,
            permissions,
            checkInMinutes,
          },
        })
      : await create({
          environmentId,
          input: {
            clientRequestId: createRequestId,
            name: name.trim(),
            modelSelection,
            permissions,
          },
        });
    if (result._tag === "Failure") return result;
    saved.current = result.value;
    if (!existing && checkInMinutes !== null) {
      result = await update({
        environmentId,
        input: {
          botId: result.value.id,
          expectedRevision: result.value.revision,
          checkInMinutes,
        },
      });
      if (result._tag === "Failure") return result;
      saved.current = result.value;
    }
    if (instructions !== result.value.instructions || memory !== result.value.memory) {
      result = await write({
        environmentId,
        input: {
          botId: result.value.id,
          expectedRevision: result.value.revision,
          instructions,
          memory,
        },
      });
      if (result._tag === "Failure") return result;
      saved.current = result.value;
    }
    return result;
  };

  const save = async () => {
    const checkInMinutes = parseCheckInMinutes(minutes);
    if (checkInMinutes === undefined) {
      setError("Check-ins must be between 5 and 10080 minutes.");
      return;
    }
    if (!model || !name.trim()) return;
    const result = await run(() => persist(model, checkInMinutes));
    if (result?._tag === "Success") onDone(result.value);
  };

  return (
    <View className="gap-6">
      <BotSection title="Profile" padded>
        <BotTextField label="Name" value={name} onChangeText={setName} maxLength={100} />
      </BotSection>
      <BotSection
        title="Defaults"
        footer="Set authority from the main conversation's message box. It also applies to tasks and proactive work."
      >
        <BotModelRow models={models} selection={model} onChange={setSelection} />
        <BotProjectPicker
          value={permissions.projects}
          onChange={(projects) => setPermissions((value) => ({ ...value, projects }))}
        />
        <SettingsSwitchRow
          icon="person.2"
          label="Delegate to other providers"
          value={permissions.allowDelegation}
          onValueChange={(allowDelegation) =>
            setPermissions((value) => ({ ...value, allowDelegation }))
          }
        />
        <SettingsSwitchRow
          icon="text.bubble"
          label="Exchange requests with bots"
          value={permissions.allowBotRequests}
          onValueChange={(allowBotRequests) =>
            setPermissions((value) => ({ ...value, allowBotRequests }))
          }
        />
      </BotSection>
      <BotSection
        title="Check-ins"
        footer="The bot decides whether anything needs doing. Its environment must stay online."
        padded
      >
        <BotTextField
          label="Minutes between check-ins"
          placeholder="Off"
          keyboardType="number-pad"
          value={minutes}
          onChangeText={setMinutes}
          maxLength={5}
        />
      </BotSection>
      <BotSection title="Instructions & memory" padded>
        <BotTextField
          label="Standing instructions"
          value={instructions}
          onChangeText={setInstructions}
          maxLength={24000}
          multiline
        />
        <BotTextField
          label="Saved memory"
          value={memory}
          onChangeText={setMemory}
          maxLength={24000}
          multiline
        />
      </BotSection>
      {bot ? <BotRemoteAccess environmentId={environmentId} botId={bot.id} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <View className="flex-row justify-end gap-2">
        <ControlPill variant="pill" label="Cancel" onPress={onCancel} />
        <ControlPill
          variant="primary"
          label={busy ? "Saving…" : bot ? "Save" : "Create bot"}
          disabled={!canSave || busy || !model || !name.trim()}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}

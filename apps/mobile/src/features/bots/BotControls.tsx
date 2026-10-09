import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { BotProfile, BotTask, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, View } from "react-native";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import { ErrorBanner } from "../../components/ErrorBanner";
import { MaterialListRow } from "../../components/MaterialListRow";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { BotSection } from "./BotFormRows";
import { BotTaskForm } from "./BotTaskForm";
import { useBotOperation } from "./useBotOperation";

const TASK_PAGE_SIZE = 10;
const TASK_STATUS_LABEL: Record<BotTask["status"], string> = {
  pending: "Queued",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

/** A bot's conversations, new task form, settings, and lifecycle actions. */
export function BotControls({
  environmentId,
  bot,
  tasks,
  loadError,
  onChanged,
  onEdit,
}: {
  environmentId: EnvironmentId;
  bot: BotProfile;
  tasks: ReadonlyArray<BotTask>;
  loadError: string | null;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const navigation = useNavigation();
  const [visibleCount, setVisibleCount] = useState(TASK_PAGE_SIZE);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const { busy, error, run } = useBotOperation();
  const update = useAtomCommand(serverEnvironment.bots.update);
  const remove = useAtomCommand(serverEnvironment.bots.remove);
  const cancelTask = useAtomCommand(serverEnvironment.bots.cancelTask);
  const canUpdate = useAtomValue(serverEnvironment.bots.update.permissionAtom(environmentId));
  const canDelete = useAtomValue(serverEnvironment.bots.remove.permissionAtom(environmentId));
  const canCancel = useAtomValue(serverEnvironment.bots.cancelTask.permissionAtom(environmentId));
  const canStart = useAtomValue(serverEnvironment.bots.startTask.permissionAtom(environmentId));
  const openThread = (threadEnvironmentId: EnvironmentId, threadId: ThreadId) =>
    navigation.navigate("Thread", { environmentId: threadEnvironmentId, threadId });
  const setPaused = (paused: boolean) =>
    void run(() =>
      update({ environmentId, input: { botId: bot.id, expectedRevision: bot.revision, paused } }),
    ).then(onChanged);
  const deleteBot = async () => {
    const result = await run(() =>
      remove({ environmentId, input: { botId: bot.id, expectedRevision: bot.revision } }),
    );
    if (result?._tag === "Success") navigation.dispatch(StackActions.popTo("Home"));
  };

  const message = error ?? loadError;

  return (
    <View className="gap-6">
      {message ? <ErrorBanner message={message} /> : null}
      <BotSection title="Conversations">
        <SettingsRow
          icon="text.bubble"
          label="Main conversation"
          onPress={() => openThread(bot.environmentId, bot.threadId)}
        />
        {tasks.slice(0, visibleCount).map((task) => (
          <BotTaskRow
            key={task.id}
            task={task}
            canStop={canCancel && !busy}
            onOpen={() => openThread(task.environmentId, task.threadId)}
            onStop={() =>
              void run(() =>
                cancelTask({ environmentId, input: { botId: bot.id, taskId: task.id } }),
              ).then(onChanged)
            }
          />
        ))}
        {tasks.length > visibleCount ? (
          <SettingsActionRow
            icon="chevron.down"
            label="Show more"
            onPress={() => setVisibleCount((count) => count + TASK_PAGE_SIZE)}
          />
        ) : null}
        <SettingsActionRow
          icon="plus"
          label="New task"
          disabled={!canStart || bot.paused || taskFormOpen}
          onPress={() => setTaskFormOpen(true)}
        />
      </BotSection>
      {taskFormOpen ? (
        <BotTaskForm
          bot={bot}
          environmentId={environmentId}
          onCancel={() => setTaskFormOpen(false)}
          onStarted={() => {
            setTaskFormOpen(false);
            onChanged();
          }}
        />
      ) : null}
      <SettingsSection title="Settings">
        <SettingsRow
          icon="person.crop.circle"
          label="Profile & memory"
          disabled={!canUpdate || busy}
          onPress={onEdit}
        />
        <SettingsRow icon="clock" label="Routines & events" target="SettingsScheduledTasks" />
        <SettingsActionRow
          icon={bot.paused ? "play" : "stop.fill"}
          label={bot.paused ? "Resume bot" : "Pause bot"}
          disabled={!canUpdate || busy}
          onPress={() => {
            if (bot.paused) return setPaused(false);
            Alert.alert(
              `Pause ${bot.name}?`,
              "This interrupts its main conversation and stops active tasks. Resuming allows new work but doesn't restart them.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Pause bot", style: "destructive", onPress: () => setPaused(true) },
              ],
            );
          }}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsActionRow
          icon="trash"
          label="Delete bot"
          tone="danger"
          disabled={!canDelete || busy}
          onPress={() =>
            Alert.alert(
              `Delete ${bot.name}?`,
              "Its profile, memory, and routines are removed. Task threads stay in their projects.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => void deleteBot() },
              ],
            )
          }
        />
      </SettingsSection>
    </View>
  );
}

function BotTaskRow({
  task,
  canStop,
  onOpen,
  onStop,
}: {
  task: BotTask;
  canStop: boolean;
  onOpen: () => void;
  onStop: () => void;
}) {
  const active = task.status === "pending" || task.status === "running";
  return (
    <ControlPillMenu
      shouldOpenOnLongPress
      actions={[
        { id: "open", title: "Open thread", image: "text.bubble" },
        ...(active
          ? [
              {
                id: "stop",
                title: "Stop task",
                image: "stop.fill",
                attributes: { destructive: true, disabled: !canStop },
              },
            ]
          : []),
      ]}
      onPressAction={({ nativeEvent }) => (nativeEvent.event === "stop" ? onStop() : onOpen())}
    >
      <MaterialListRow
        className="bg-grouped-card"
        title={task.title}
        subtitle={task.needsAttention ? "Approval needed" : TASK_STATUS_LABEL[task.status]}
        leading={<SymbolView name="text.bubble" size={20} tintColorClassName="accent-icon-muted" />}
        onPress={onOpen}
      />
    </ControlPillMenu>
  );
}

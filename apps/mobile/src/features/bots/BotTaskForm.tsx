import { useNavigation } from "@react-navigation/native";
import { botProjectKey } from "@t3tools/client-runtime/state/bots";
import type { BotProfile, EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { ControlPill } from "../../components/ControlPill";
import { ErrorBanner } from "../../components/ErrorBanner";
import { buildModelOptions } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotMenuRow, BotModelRow, BotSection, BotTextField } from "./BotFormRows";
import { remoteBotTaskModel } from "./botTaskModel";
import { useBotOperation } from "./useBotOperation";

const BOT_WORKSPACE = "home";

/** Starts a separate task thread in the bot's workspace or one of its projects. */
export function BotTaskForm({
  bot,
  environmentId,
  onStarted,
  onCancel,
}: {
  bot: BotProfile;
  environmentId: EnvironmentId;
  onStarted: () => void;
  onCancel: () => void;
}) {
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const allowed = new Set(bot.permissions.projects.map(botProjectKey));
  const projects = useProjects().filter((project) =>
    allowed.has(botProjectKey({ environmentId: project.environmentId, projectId: project.id })),
  );
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [projectKey, setProjectKey] = useState(BOT_WORKSPACE);
  const [taskModel, setTaskModel] = useState<ModelSelection | null>(null);
  const project = projects.find(
    (item) =>
      botProjectKey({ environmentId: item.environmentId, projectId: item.id }) === projectKey,
  );
  const config = useEnvironmentServerConfig(project?.environmentId ?? environmentId);
  const remote = project !== undefined && project.environmentId !== environmentId;
  const remoteDefault = remote ? remoteBotTaskModel(config, bot.modelSelection, project) : null;
  // The server applies the bot's own model to tasks on its environment, so only a picked
  // model or a remote default is sent.
  const modelSelection = taskModel ?? remoteDefault;
  const selection = remote ? modelSelection : (modelSelection ?? bot.modelSelection);
  const models = useMemo(() => buildModelOptions(config, selection), [config, selection]);
  const start = useAtomCommand(serverEnvironment.bots.startTask);
  const { busy, error, run } = useBotOperation();

  // A failed launch stays saved and is retried by the server, so retrying the same request
  // reuses its id instead of starting a second task.
  const lastRequest = useRef<{ readonly key: string; readonly id: string } | null>(null);

  const submit = async () => {
    if (!selection || !title.trim() || !text.trim()) return;
    const request = {
      botId: bot.id,
      title: title.trim(),
      text: text.trim(),
      ...(modelSelection === null ? {} : { modelSelection }),
      ...(project ? { projectId: project.id, environmentId: project.environmentId } : {}),
    };
    const key = JSON.stringify(request);
    if (lastRequest.current?.key !== key) lastRequest.current = { key, id: uuidv4() };
    const clientRequestId = lastRequest.current.id;
    const result = await run(() =>
      start({ environmentId, input: { ...request, clientRequestId } }),
    );
    if (result?._tag !== "Success") return;
    onStarted();
    navigation.navigate("Thread", {
      environmentId: result.value.environmentId,
      threadId: result.value.threadId,
    });
  };

  return (
    <View className="gap-6">
      <BotSection title="New task" padded>
        <BotTextField label="Title" value={title} onChangeText={setTitle} maxLength={200} />
        <BotTextField
          label="What should it do?"
          value={text}
          onChangeText={setText}
          maxLength={100000}
          multiline
        />
      </BotSection>
      <BotSection>
        <BotMenuRow
          icon="folder"
          label="Project"
          value={project?.title ?? "Bot workspace"}
          actions={[
            {
              id: BOT_WORKSPACE,
              title: "Bot workspace",
              state: project ? "off" : "on",
            },
            ...projects.map((item) => {
              const key = botProjectKey({ environmentId: item.environmentId, projectId: item.id });
              return {
                id: key,
                title: item.title,
                subtitle: environments.find((env) => env.environmentId === item.environmentId)
                  ?.label,
                state: key === projectKey ? ("on" as const) : ("off" as const),
              };
            }),
          ]}
          onSelect={(key) => {
            // Model choices are per environment, so a new project starts from the bot default.
            setProjectKey(key);
            setTaskModel(null);
          }}
        />
        <BotModelRow models={models} selection={selection} onChange={setTaskModel} />
      </BotSection>
      {error ? <ErrorBanner message={error} /> : null}
      <View className="flex-row justify-end gap-2">
        <ControlPill variant="pill" label="Cancel" onPress={onCancel} />
        <ControlPill
          variant="primary"
          label="Start task"
          disabled={busy || !selection || !title.trim() || !text.trim()}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

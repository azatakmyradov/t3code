import { useAtomValue } from "@effect/atom-react";
import { botProjectKey, botProjectOptions } from "@t3tools/client-runtime/state/bots";
import type { BotSummary, ModelSelection } from "@t3tools/contracts";
import { useMemo, useRef, useState } from "react";
import { randomUUID } from "../../lib/utils";
import { resolveDefaultProviderModelSelection } from "../../providerInstances";
import { useEnvironmentIdentities } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { BotModelPicker } from "./BotModelPicker";
import { botCommandError, useOpenBotThread } from "./botCommands";
import { useBotProjects } from "./useBotProjects";

const BOT_WORKSPACE = "bot";

/** Starts a separate task thread for a bot, in its own workspace or one of its projects. */
export function BotTaskDialog({ bot, onClose }: { bot: BotSummary; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [workspaceKey, setWorkspaceKey] = useState(BOT_WORKSPACE);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const environments = useEnvironmentIdentities();
  const allowed = new Set(bot.permissions.projects.map(botProjectKey));
  const projects = useBotProjects();
  const workspaces = botProjectOptions(projects, environments, bot.permissions.projects).filter(
    (option) => option.available && allowed.has(option.key),
  );
  const workspace = workspaces.find((option) => option.key === workspaceKey);
  const destination = workspace?.access.environmentId ?? bot.environmentId;
  const remote = destination !== bot.environmentId;
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(destination)) ?? EMPTY_SERVER_PROVIDERS;
  // Models route by provider instance id, which another environment may not have. The server
  // applies the bot's own model on its environment, so only a picked model or a remote default
  // is sent.
  const remoteDefault = useMemo(
    () => (remote ? resolveDefaultProviderModelSelection(providers, bot.modelSelection) : null),
    [remote, providers, bot.modelSelection],
  );
  const modelSelection = model ?? remoteDefault;
  const selection = remote ? modelSelection : (modelSelection ?? bot.modelSelection);
  const canStart = useAtomValue(serverEnvironment.bots.startTask.permissionAtom(bot.environmentId));
  const start = useAtomCommand(serverEnvironment.bots.startTask);
  const openThread = useOpenBotThread();
  // A failed launch stays saved and is retried by the server, so retrying the same request
  // reuses its id instead of starting a second task.
  const lastRequest = useRef<{ readonly key: string; readonly id: string } | null>(null);

  const submit = async () => {
    setStarting(true);
    setError(null);
    const request = {
      botId: bot.id,
      title: title.trim(),
      text: text.trim(),
      ...(modelSelection ? { modelSelection } : {}),
      ...(workspace ? workspace.access : {}),
    };
    const key = JSON.stringify(request);
    if (lastRequest.current?.key !== key) lastRequest.current = { key, id: randomUUID() };
    const result = await start({
      environmentId: bot.environmentId,
      input: { ...request, clientRequestId: lastRequest.current.id },
    });
    setStarting(false);
    if (result._tag === "Failure") {
      setError(botCommandError(result));
      return;
    }
    onClose();
    await openThread(result.value.environmentId, result.value.threadId);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New thread</DialogTitle>
          <DialogDescription>
            A separate job for {bot.name}. Results return to its main conversation.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogPanel>
            <fieldset disabled={starting} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bot-task-title">Title</Label>
                <Input
                  id="bot-task-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bot-task-workspace">Workspace</Label>
                <Select
                  value={workspaceKey}
                  onValueChange={(value) => {
                    setWorkspaceKey(value ?? BOT_WORKSPACE);
                    setModel(null);
                  }}
                >
                  <SelectTrigger id="bot-task-workspace">
                    <SelectValue>{workspace?.title ?? "Bot workspace"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={BOT_WORKSPACE}>Bot workspace</SelectItem>
                    {workspaces.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.title} · {option.environmentLabel}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Model</Label>
                {selection ? (
                  <BotModelPicker
                    environmentId={destination}
                    selection={selection}
                    onChange={setModel}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No models available on this environment.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bot-task-text">Job</Label>
                <Textarea
                  id="bot-task-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={100000}
                  required
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </fieldset>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              type="submit"
              disabled={
                !canStart || bot.paused || starting || !selection || !title.trim() || !text.trim()
              }
            >
              Start thread
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

import { useAtomValue } from "@effect/atom-react";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessWriteScope,
  type BotId,
  type BotPermissions,
  type BotProfile,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentIdentities, useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import { DialogClose, DialogFooter, DialogPanel } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { BotModelPicker, useProviderEntries } from "./BotModelPicker";
import { BotProjectPicker } from "./BotProjectPicker";
import { botCommandError } from "./botCommands";

const NEW_BOT_PERMISSIONS: BotPermissions = {
  runtimeMode: "approval-required",
  allowDelegation: true,
  allowBotRequests: true,
  projects: [],
};

/**
 * Dialog body for creating a bot (`bot` null) or editing its profile and memory.
 * New bots pick their home environment here; their role is taught through chat.
 */
export function BotEditor({
  environmentId: initialEnvironmentId,
  bot,
  onSaved,
}: {
  environmentId: EnvironmentId;
  bot: BotProfile | null;
  onSaved: (bot: BotProfile) => void | Promise<void>;
}) {
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const [name, setName] = useState(bot?.name ?? "");
  const [selection, setSelection] = useState<ModelSelection | null>(bot?.modelSelection ?? null);
  const [permissions, setPermissions] = useState(bot?.permissions ?? NEW_BOT_PERMISSIONS);
  const [checkIn, setCheckIn] = useState(bot?.checkInMinutes?.toString() ?? "");
  const [instructions, setInstructions] = useState(bot?.instructions ?? "");
  const [memory, setMemory] = useState(bot?.memory ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientRequestId] = useState(randomUUID);
  const revision = useRef(bot?.revision ?? 0);
  const environments = useEnvironmentIdentities();
  const { settings, entries } = useProviderEntries(environmentId);
  const model = selection ?? scheduledTaskDefaultModel(settings, null, entries);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supported = bot !== null || config?.environment.capabilities.bots === true;
  const command = bot ? serverEnvironment.bots.update : serverEnvironment.bots.create;
  const canSave = useAtomValue(command.permissionAtom(environmentId));
  const create = useAtomCommand(serverEnvironment.bots.create);
  const update = useAtomCommand(serverEnvironment.bots.update);
  const writeContext = useAtomCommand(serverEnvironment.bots.writeContext);

  const save = async () => {
    if (!model) return;
    const profile = { name: name.trim(), modelSelection: model, permissions };
    const checkInMinutes = checkIn === "" ? null : Number(checkIn);
    setSaving(true);
    setError(null);
    let result: AtomCommandResult<BotProfile, unknown> = bot
      ? await update({
          environmentId,
          input: { botId: bot.id, expectedRevision: revision.current, ...profile, checkInMinutes },
        })
      : await create({ environmentId, input: { clientRequestId, ...profile } });
    // Notes are written separately, against the revision the profile update produced.
    if (bot && result._tag === "Success") {
      revision.current = result.value.revision;
      if (result.value.instructions !== instructions || result.value.memory !== memory) {
        result = await writeContext({
          environmentId,
          input: { botId: bot.id, expectedRevision: revision.current, instructions, memory },
        });
      }
    }
    setSaving(false);
    if (result._tag === "Failure") {
      setError(botCommandError(result));
      return;
    }
    revision.current = result.value.revision;
    await onSaved(result.value);
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogPanel>
        <fieldset disabled={saving} className="space-y-4">
          {!bot && (
            <div className="space-y-1.5">
              <Label htmlFor="bot-environment">Home environment</Label>
              <Select
                value={environmentId}
                onValueChange={(value) => {
                  const next = environments.find((item) => item.environmentId === value);
                  if (!next) return;
                  setEnvironmentId(next.environmentId);
                  setSelection(null);
                }}
              >
                <SelectTrigger id="bot-environment">
                  <SelectValue>
                    {environments.find((item) => item.environmentId === environmentId)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((item) => (
                    <SelectItem key={item.environmentId} value={item.environmentId}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {!supported && (
                <p className="text-xs text-muted-foreground">
                  {config
                    ? "Update this environment’s T3 server to use bots."
                    : "Connecting to environment…"}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="bot-name">Name</Label>
            <Input
              id="bot-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Default model</Label>
            {model ? (
              <BotModelPicker
                environmentId={environmentId}
                selection={model}
                onChange={setSelection}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Set up a provider in Settings first.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bot-projects">Projects</Label>
            <BotProjectPicker
              id="bot-projects"
              value={permissions.projects}
              onChange={(projects) => setPermissions((value) => ({ ...value, projects }))}
            />
            <p className="text-xs text-muted-foreground">
              Change access from the main conversation’s message box.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="bot-delegation">Delegate to other providers</Label>
            <Switch
              id="bot-delegation"
              checked={permissions.allowDelegation}
              onCheckedChange={(allowDelegation) =>
                setPermissions((value) => ({ ...value, allowDelegation }))
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="bot-requests">Exchange requests with other bots</Label>
            <Switch
              id="bot-requests"
              checked={permissions.allowBotRequests}
              onCheckedChange={(allowBotRequests) =>
                setPermissions((value) => ({ ...value, allowBotRequests }))
              }
            />
          </div>

          {bot && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bot-check-in">Check-in interval (minutes)</Label>
                <Input
                  id="bot-check-in"
                  type="number"
                  min={5}
                  max={10080}
                  value={checkIn}
                  onChange={(event) => setCheckIn(event.target.value)}
                  placeholder="Off"
                />
                <p className="text-xs text-muted-foreground">
                  The bot decides whether anything needs doing. Leave blank to turn off.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bot-instructions">Instructions</Label>
                <Textarea
                  id="bot-instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  maxLength={24000}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground">
                  You can also teach the bot through chat.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bot-memory">Memory</Label>
                <Textarea
                  id="bot-memory"
                  value={memory}
                  onChange={(event) => setMemory(event.target.value)}
                  maxLength={24000}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Facts and preferences the bot saved. Edit or clear them anytime.
                </p>
              </div>

              <RemoteAccess environmentId={environmentId} botId={bot.id} />
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </fieldset>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!canSave || !supported || saving || !name.trim() || !model}>
          {bot ? "Save" : "Create bot"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Grants the bot's home server its own credential for background work on another environment. */
function RemoteAccess({ environmentId, botId }: { environmentId: EnvironmentId; botId: BotId }) {
  const { environments } = useEnvironments();
  const remotes = environments.filter((environment) => environment.environmentId !== environmentId);
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const selected = remotes.find((remote) => remote.environmentId === selectedId) ?? remotes[0];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connections = useEnvironmentQuery(
    serverEnvironment.bots.connections({ environmentId, input: { botId } }),
  );
  const connect = useAtomCommand(serverEnvironment.bots.connect);
  const disconnect = useAtomCommand(serverEnvironment.bots.disconnect);
  const canConnect = useAtomValue(serverEnvironment.bots.connect.permissionAtom(environmentId));
  const canDisconnect = useAtomValue(
    serverEnvironment.bots.disconnect.permissionAtom(environmentId),
  );
  const canGrantAccess = useEnvironmentScope(selected?.environmentId ?? null, AuthAccessWriteScope);
  const connected = selected?.connection.phase === "connected";

  const run = async (action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setPending(true);
    const result = await action();
    setPending(false);
    setError(botCommandError(result));
    connections.refresh();
  };

  const hint = !selected
    ? "Add an environment in Connections first."
    : !connected
      ? "Connect to this environment in Connections first."
      : !canGrantAccess
        ? "This connection can’t manage access on that environment."
        : "Grant access, then select its projects above.";

  return (
    <div className="space-y-1.5">
      <Label htmlFor="bot-remote-environment">Remote environments</Label>
      {connections.data?.map((connection) => (
        <div key={connection.environmentId} className="flex items-center justify-between gap-4">
          <span className="min-w-0 truncate text-sm">{connection.label}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!canDisconnect || pending}
            onClick={() =>
              void run(() =>
                disconnect({
                  environmentId,
                  input: { botId, environmentId: connection.environmentId },
                }),
              )
            }
          >
            Disconnect
          </Button>
        </div>
      ))}
      {selected && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select
              value={selected.environmentId}
              onValueChange={(value) =>
                setSelectedId(
                  remotes.find((remote) => remote.environmentId === value)?.environmentId ?? null,
                )
              }
            >
              <SelectTrigger id="bot-remote-environment">
                <SelectValue>{selected.label}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {remotes.map((remote) => (
                  <SelectItem key={remote.environmentId} value={remote.environmentId}>
                    {remote.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!canConnect || !canGrantAccess || !connected || pending}
            onClick={() =>
              void run(() =>
                connect({
                  environmentId,
                  input: { botId, remoteEnvironmentId: selected.environmentId },
                }),
              )
            }
          >
            Grant access
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <Button render={<Link to="/settings/connections" />} variant="link" size="xs">
          Open Connections
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

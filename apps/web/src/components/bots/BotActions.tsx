import { useAtomValue } from "@effect/atom-react";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { BotSummary } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ClockIcon, PauseIcon, PlayIcon, PlusIcon, SettingsIcon, TrashIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { readLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { BotProfileDialog } from "./BotProfileDialog";
import { BotTaskDialog } from "./BotTaskDialog";
import { botCommandError } from "./botCommands";

export interface BotAction {
  readonly id: "profile" | "thread" | "pause" | "routines" | "delete";
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled: boolean;
  readonly destructive?: boolean;
  readonly onSelect: () => void;
}

async function confirmDestructive(message: string) {
  const api = readLocalApi();
  if (!api) return false;
  return api.dialogs.confirm(message, { variant: "destructive" }).catch(() => false);
}

/**
 * Bot commands shared by the sidebar context menu and the details panel.
 * Callers render `dialogs`, which hosts the profile and new-thread dialogs.
 */
export function useBotActions(bot: BotSummary) {
  const [dialog, setDialog] = useState<"profile" | "thread" | null>(null);
  const [pending, setPending] = useState(false);
  const route = useParams({ strict: false });
  const navigate = useNavigate();
  const canUpdate = useAtomValue(serverEnvironment.bots.update.permissionAtom(bot.environmentId));
  const canRemove = useAtomValue(serverEnvironment.bots.remove.permissionAtom(bot.environmentId));
  const canStartTask = useAtomValue(
    serverEnvironment.bots.startTask.permissionAtom(bot.environmentId),
  );
  const update = useAtomCommand(serverEnvironment.bots.update);
  const remove = useAtomCommand(serverEnvironment.bots.remove);

  const run = async (
    failureTitle: string,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    setPending(true);
    const result = await command();
    setPending(false);
    const error = botCommandError(result);
    if (error) {
      toastManager.add(
        stackedThreadToast({ type: "error", title: failureTitle, description: error }),
      );
    }
    return result._tag === "Success";
  };

  const setPaused = async (paused: boolean) => {
    if (
      paused &&
      !(await confirmDestructive(
        `Pause ${bot.name}?\nThis interrupts its main conversation and cancels active tasks. Resuming doesn't restart them.`,
      ))
    ) {
      return;
    }
    await run(paused ? "Couldn't pause bot" : "Couldn't resume bot", () =>
      update({
        environmentId: bot.environmentId,
        input: { botId: bot.id, expectedRevision: bot.revision, paused },
      }),
    );
  };

  const deleteBot = async () => {
    if (
      !(await confirmDestructive(
        `Delete ${bot.name}?\nIts profile, memory, and routines are removed and its main conversation is archived. Task threads stay in their projects.`,
      ))
    ) {
      return;
    }
    const viewingMain =
      route.environmentId === bot.environmentId && route.threadId === bot.threadId;
    const deleted = await run("Couldn't delete bot", () =>
      remove({
        environmentId: bot.environmentId,
        input: { botId: bot.id, expectedRevision: bot.revision },
      }),
    );
    if (deleted && viewingMain) void navigate({ to: "/bots" });
  };

  const actions: ReadonlyArray<BotAction> = [
    {
      id: "profile",
      label: "Profile & memory",
      icon: <SettingsIcon />,
      disabled: false,
      onSelect: () => setDialog("profile"),
    },
    {
      id: "thread",
      label: "New thread",
      icon: <PlusIcon />,
      disabled: !canStartTask || bot.paused,
      onSelect: () => setDialog("thread"),
    },
    {
      id: "pause",
      label: bot.paused ? "Resume bot" : "Pause bot",
      icon: bot.paused ? <PlayIcon /> : <PauseIcon />,
      disabled: !canUpdate || pending,
      onSelect: () => void setPaused(!bot.paused),
    },
    {
      id: "routines",
      label: "Routines & events",
      icon: <ClockIcon />,
      disabled: false,
      onSelect: () =>
        void navigate({
          to: "/settings/scheduled-tasks",
          search: { environmentId: bot.environmentId },
        }),
    },
    {
      id: "delete",
      label: "Delete bot",
      icon: <TrashIcon />,
      disabled: !canRemove || pending,
      destructive: true,
      onSelect: () => void deleteBot(),
    },
  ];

  const openContextMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const selected = await api.contextMenu
      .show(
        actions.map(({ id, label, disabled, destructive }) => ({
          id,
          label,
          disabled,
          ...(destructive ? { destructive, separatorBefore: true } : {}),
        })),
        position,
      )
      .catch(() => null);
    const action = actions.find((action) => action.id === selected);
    if (action && !action.disabled) action.onSelect();
  };

  const close = () => setDialog(null);
  const dialogs =
    dialog === "profile" ? (
      <BotProfileDialog bot={bot} onClose={close} />
    ) : dialog === "thread" ? (
      <BotTaskDialog bot={bot} onClose={close} />
    ) : null;

  return { actions, openContextMenu, dialogs };
}

import { useAtomValue } from "@effect/atom-react";
import { Link, useParams } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { BotNavigationThread, BotSummary } from "@t3tools/contracts";
import { BotIcon, PlusIcon, PauseIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { botNavigationAtom } from "../../state/bots";
import { useEnvironmentIdentities } from "../../state/environments";
import { environmentThreadShells } from "../../state/threads";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "../ui/sidebar";
import { useBotActions } from "./BotActions";
import { NewBotDialog } from "./BotProfileDialog";
import { createBotActivityAtom } from "./botActivity";

export function SidebarBotsSection() {
  const bots = useAtomValue(botNavigationAtom);
  const [expanded, setExpanded] = useState(true);
  const [creating, setCreating] = useState(false);
  return (
    <SidebarGroup aria-label="Bots">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <CollapsibleSectionHeader
            expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            Bots
          </CollapsibleSectionHeader>
        </div>
        <SidebarHeaderIconButton label="New bot" onClick={() => setCreating(true)}>
          <PlusIcon className="size-4" />
        </SidebarHeaderIconButton>
      </div>
      {expanded && (
        <SidebarMenu>
          {bots.map(({ bot, threads }) => (
            <SidebarBot key={`${bot.environmentId}:${bot.id}`} bot={bot} threads={threads} />
          ))}
        </SidebarMenu>
      )}
      {creating && <NewBotDialog onClose={() => setCreating(false)} />}
    </SidebarGroup>
  );
}

function SidebarBot({
  bot,
  threads,
}: {
  bot: BotSummary;
  threads: ReadonlyArray<BotNavigationThread>;
}) {
  const route = useParams({ strict: false });
  const { isMobile, setOpenMobile } = useSidebar();
  const environments = useEnvironmentIdentities();
  const { openContextMenu, dialogs } = useBotActions(bot);
  const activityAtom = useMemo(
    () =>
      createBotActivityAtom(
        [
          scopeThreadRef(bot.environmentId, bot.threadId),
          ...threads.map((thread) => scopeThreadRef(thread.environmentId, thread.threadId)),
        ],
        environmentThreadShells.threadShellAtom,
      ),
    [bot.environmentId, bot.threadId, threads],
  );
  const activity = useAtomValue(activityAtom);
  const active =
    (bot.environmentId === route.environmentId && bot.threadId === route.threadId) ||
    threads.some(
      (thread) =>
        thread.environmentId === route.environmentId && thread.threadId === route.threadId,
    );
  const environmentLabel =
    environments.length > 1
      ? environments.find((environment) => environment.environmentId === bot.environmentId)?.label
      : null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        render={
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: bot.environmentId, threadId: bot.threadId }}
          />
        }
        onClick={() => {
          if (isMobile) setOpenMobile(false);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void openContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <BotIcon />
        <span className="min-w-0 flex-1 truncate">{bot.name}</span>
        {activity && <ThreadStatusLabel status={activity} compact />}
        {bot.paused && <PauseIcon className="size-3" aria-label="Paused" />}
      </SidebarMenuButton>
      {environmentLabel && (
        <p className="ml-8 truncate text-xs text-sidebar-muted-foreground">{environmentLabel}</p>
      )}
      {dialogs}
    </SidebarMenuItem>
  );
}

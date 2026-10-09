import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  BOT_NAVIGATION_THREAD_LIMIT,
  type BotNavigationThread,
  type BotSummary,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { MessageSquareIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { botNavigationAtom } from "../../state/bots";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { ThreadRowLeadingStatus } from "../ThreadStatusIndicators";
import { ThreadDetailsCard } from "../chat/ThreadDetailsCard";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import type { ThreadDetailsPanelProps } from "../chat/ThreadDetailsPanel";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { Button } from "../ui/button";
import { useBotActions, type BotAction } from "./BotActions";

const THREAD_PAGE_SIZE = 12;

/** Thread details for a bot's conversations: its threads, then the bot's own controls. */
export function BotDetailsPanel({
  bot,
  environmentId,
  threadId,
  anchor,
  handle,
  onPresentationChange,
}: Pick<
  ThreadDetailsPanelProps,
  "environmentId" | "threadId" | "anchor" | "handle" | "onPresentationChange"
> & {
  bot: BotSummary;
}) {
  const navigation = useAtomValue(botNavigationAtom);
  const [visibleCount, setVisibleCount] = useState(THREAD_PAGE_SIZE);
  const { actions, dialogs } = useBotActions(bot);
  const threads =
    navigation.find(
      (entry) => entry.bot.id === bot.id && entry.bot.environmentId === bot.environmentId,
    )?.threads ?? [];
  const threadRef = scopeThreadRef(environmentId, threadId);
  const visibleThreads = threads.slice(0, visibleCount);
  // Navigation carries only recent tasks; older ones load from the bot's detail on request.
  const hasOlder = threads.length >= BOT_NAVIGATION_THREAD_LIMIT;
  const showingOlder = hasOlder && visibleCount > threads.length;
  // Keep the open task listed even when it is past the current page or the recent tasks.
  const isOpenTask = threadId !== bot.threadId;
  const activeTask = isOpenTask
    ? (threads.find(
        (thread) => thread.environmentId === environmentId && thread.threadId === threadId,
      ) ?? { botId: bot.id, environmentId, threadId, title: "Task" })
    : null;
  if (activeTask && !visibleThreads.includes(activeTask) && !showingOlder)
    visibleThreads.push(activeTask);
  const newThread = actions.find((action) => action.id === "thread");
  const controls = actions.filter((action) => action.id !== "thread" && !action.destructive);
  const destructive = actions.filter((action) => action.destructive);

  return (
    <>
      <ThreadDetailsCard
        threadRef={threadRef}
        anchor={anchor}
        handle={handle}
        onPresentationChange={onPresentationChange}
      >
        {() => (
          <>
            <ThreadDetailsSection
              headingId="bot-threads-heading"
              title="Threads"
              separated={false}
              actions={
                newThread && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="New bot thread"
                    disabled={newThread.disabled}
                    onClick={newThread.onSelect}
                  >
                    <PlusIcon />
                  </Button>
                )
              }
            >
              <nav aria-label={`${bot.name} threads`}>
                <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto overscroll-contain p-0">
                  <BotThreadRow
                    thread={{
                      botId: bot.id,
                      environmentId: bot.environmentId,
                      threadId: bot.threadId,
                      title: "Main conversation",
                    }}
                    activeThread={threadRef}
                    main
                  />
                  {visibleThreads.map((thread) => (
                    <BotThreadRow
                      key={`${thread.environmentId}:${thread.threadId}`}
                      thread={thread}
                      activeThread={threadRef}
                    />
                  ))}
                  {showingOlder && (
                    <OlderBotThreads bot={bot} recent={threads} activeThread={threadRef} />
                  )}
                </ul>
                {(threads.length > visibleCount || (hasOlder && !showingOlder)) && (
                  <ThreadDetailsControl
                    onClick={() => setVisibleCount((count) => count + THREAD_PAGE_SIZE)}
                    tone="muted"
                  >
                    <PlusIcon />
                    Show more threads
                  </ThreadDetailsControl>
                )}
              </nav>
            </ThreadDetailsSection>
            <ThreadDetailsSection headingId="bot-controls-heading" title="Bot" showHeading={false}>
              {controls.map((action) => (
                <BotActionControl key={action.id} action={action} />
              ))}
            </ThreadDetailsSection>
            <ThreadDetailsSection
              headingId="bot-delete-heading"
              title="Delete bot"
              showHeading={false}
            >
              {destructive.map((action) => (
                <BotActionControl key={action.id} action={action} />
              ))}
            </ThreadDetailsSection>
          </>
        )}
      </ThreadDetailsCard>
      {dialogs}
    </>
  );
}

function OlderBotThreads({
  bot,
  recent,
  activeThread,
}: {
  bot: BotSummary;
  recent: ReadonlyArray<BotNavigationThread>;
  activeThread: ScopedThreadRef;
}) {
  const detail = useEnvironmentQuery(
    serverEnvironment.bots.detail({ environmentId: bot.environmentId, input: { botId: bot.id } }),
  );
  // Navigation also carries older unfinished tasks, so it is not a prefix of the detail list.
  const listed = new Set(recent.map((thread) => thread.threadId));
  return detail.data?.tasks
    .filter((task) => !listed.has(task.threadId))
    .map((task) => (
      <BotThreadRow
        key={`${task.environmentId}:${task.threadId}`}
        thread={task}
        activeThread={activeThread}
      />
    ));
}

function BotActionControl({ action }: { action: BotAction }) {
  return (
    <ThreadDetailsControl
      tone={action.destructive ? "destructive" : "default"}
      disabled={action.disabled}
      onClick={action.onSelect}
    >
      {action.icon}
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
    </ThreadDetailsControl>
  );
}

function BotThreadRow({
  thread,
  activeThread,
  main = false,
}: {
  thread: BotNavigationThread;
  activeThread: ScopedThreadRef;
  main?: boolean;
}) {
  const shell = useThreadShell(scopeThreadRef(thread.environmentId, thread.threadId));
  if (shell?.archivedAt) return null;
  const active =
    thread.environmentId === activeThread.environmentId &&
    thread.threadId === activeThread.threadId;
  const title = main ? "Main conversation" : (shell?.title ?? thread.title);
  return (
    <li>
      <ThreadDetailsControl
        render={
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: thread.environmentId, threadId: thread.threadId }}
          />
        }
        aria-current={active ? "page" : undefined}
        tone={active ? "primary" : "default"}
        title={title}
      >
        {shell ? <ThreadRowLeadingStatus thread={shell} /> : <MessageSquareIcon />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </ThreadDetailsControl>
    </li>
  );
}

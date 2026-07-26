import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import { subagentContextPercent } from "@t3tools/fork-subagents/presentation";
import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type MessageId,
  type NativeHarnessSubagentSummary,
  type ThreadId,
} from "@t3tools/contracts";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { type LegendListRef } from "@legendapp/list/react";
import { AlertTriangle, ArrowLeft, Bot, CircleStop, Clock, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { MessagesTimeline } from "../../components/chat/MessagesTimeline";
import { type ExpandedImagePreview } from "../../components/chat/ExpandedImagePreview";
import { useThreadDetail } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { nativeSubagentEnvironment } from "../../state/nativeSubagents";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn, newMessageId } from "../../lib/utils";
import {
  deriveActiveWorkStartedAt,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  isLatestTurnSettled,
} from "../../session-logic";
import { type ChatMessage, type TurnDiffSummary } from "../../types";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { subagentStatusColor } from "./subagentStatusColor";

const EMPTY_CHILD_TURN_DIFF_SUMMARIES = new Map<MessageId, TurnDiffSummary>();
const EMPTY_CHILD_REVERT_COUNTS = new Map<MessageId, number>();
const noop = () => {};

function formatElapsed(createdAt: string, settledAt: string | null): string {
  const milliseconds = Math.max(
    0,
    Date.parse(settledAt ?? new Date().toISOString()) - Date.parse(createdAt),
  );
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function subagentNeedsAttention(summary: SubagentSummary): boolean {
  return summary.hasPendingApproval || summary.hasPendingUserInput;
}

function subagentStatusLabel(summary: SubagentSummary): string {
  if (summary.hasPendingApproval) return "Approval needed";
  if (summary.hasPendingUserInput) return "Input needed";
  if (summary.status === "running") return "Running";
  if (summary.status === "error") return "Failed";
  return "Done";
}

function nativeStatusLabel(summary: NativeHarnessSubagentSummary): string {
  if (summary.status === "running") return "Running";
  if (summary.status === "done") return "Done";
  if (summary.status === "interrupted") return "Interrupted";
  if (summary.status === "error") return "Failed";
  return "Status unavailable";
}

function sortSummaries(summaries: ReadonlyArray<SubagentSummary>): ReadonlyArray<SubagentSummary> {
  const rank = (summary: SubagentSummary): number =>
    subagentNeedsAttention(summary) ? 0 : summary.status === "running" ? 1 : 2;
  return [...summaries].sort((a, b) => rank(a) - rank(b));
}

function StatusDot(props: { readonly summary: SubagentSummary }) {
  if (props.summary.status !== "running" && props.summary.status !== "error") {
    return null;
  }
  const color = subagentStatusColor(props.summary.status);
  return (
    <span className="relative flex size-2 shrink-0">
      {props.summary.status === "running" ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            color,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

function ContextMeter(props: { readonly percent: number; readonly className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 tabular-nums", props.className)}
      title={`${props.percent}% of context used`}
    >
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            props.percent >= 90
              ? "bg-red-500"
              : props.percent >= 70
                ? "bg-amber-500"
                : "bg-emerald-500/70",
          )}
          style={{ width: `${Math.max(props.percent, 2)}%` }}
        />
      </span>
      <span>{props.percent}%</span>
    </span>
  );
}

export function AgentsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly summaries: ReadonlyArray<SubagentSummary>;
  readonly nativeSummaries: ReadonlyArray<NativeHarnessSubagentSummary>;
  readonly nativePending: boolean;
  readonly nativeError: string | null;
  readonly parentThreadId: ThreadId | null;
  readonly parentUpdatedAt: string | null;
  readonly parentSessionActive: boolean;
  readonly refreshNativeList: () => void;
  readonly maximized: boolean;
  readonly resolvedTheme: "light" | "dark";
  readonly timestampFormat: TimestampFormat;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    props.summaries.find((summary) => `managed:${summary.displayId}` === selectedId) ?? null;
  const nativeSelected =
    props.nativeSummaries.find((summary) => `native:${summary.id}` === selectedId) ?? null;
  const nativeDetailQuery = useEnvironmentQuery(
    nativeSelected && props.parentThreadId
      ? nativeSubagentEnvironment.read({
          environmentId: props.environmentId,
          input: {
            threadId: props.parentThreadId,
            nativeSubagentId: nativeSelected.id,
          },
        })
      : null,
  );
  const childRef = selected ? scopeThreadRef(props.environmentId, selected.threadId) : null;
  const child = useThreadDetail(childRef);
  const summaries = child
    ? foldSubagentSummaries(child.activities, props.summaries)
    : props.summaries;
  const sortedSummaries = useMemo(() => sortSummaries(summaries), [summaries]);
  const sortedEntries = useMemo(
    () =>
      [
        ...sortedSummaries.map((summary) => ({
          key: `managed:${summary.displayId}`,
          source: "managed" as const,
          rank: subagentNeedsAttention(summary) ? 0 : summary.status === "running" ? 1 : 2,
          summary,
        })),
        ...props.nativeSummaries.map((summary) => ({
          key: `native:${summary.id}`,
          source: "native" as const,
          rank: summary.status === "running" ? 1 : 2,
          summary,
        })),
      ].sort((a, b) => a.rank - b.rank),
    [props.nativeSummaries, sortedSummaries],
  );
  const startTurn = useAtomCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState("");
  const [inputDrafts, setInputDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const timelineListRef = useRef<LegendListRef | null>(null);
  const childAttachmentIds = useMemo(() => {
    const attachmentIds = new Set<string>();
    for (const message of child?.messages ?? []) {
      for (const attachment of message.attachments ?? []) {
        attachmentIds.add(attachment.id);
      }
    }
    return [...attachmentIds];
  }, [child?.messages]);
  const childAttachmentResources = useMemo(
    () =>
      childAttachmentIds.map((attachmentId) => ({
        _tag: "attachment" as const,
        attachmentId,
      })),
    [childAttachmentIds],
  );
  const childAttachmentUrls = useAssetUrls(props.environmentId, childAttachmentResources);
  const childAttachmentUrlById = useMemo(
    () =>
      new Map(
        childAttachmentIds.flatMap((attachmentId, index) => {
          const url = childAttachmentUrls[index];
          return url ? [[attachmentId, url] as const] : [];
        }),
      ),
    [childAttachmentIds, childAttachmentUrls],
  );
  const childMessages = useMemo<ReadonlyArray<ChatMessage>>(
    () =>
      (child?.messages ?? []).map((message) => ({
        ...message,
        attachments: message.attachments?.map((attachment) => {
          const previewUrl = childAttachmentUrlById.get(attachment.id);
          return previewUrl ? { ...attachment, previewUrl } : attachment;
        }),
      })),
    [child?.messages, childAttachmentUrlById],
  );
  const childWorkEntries = useMemo(
    () => deriveWorkLogEntries(child?.activities ?? []),
    [child?.activities],
  );
  const childTimelineEntries = useMemo(
    () => deriveTimelineEntries(childMessages, child?.proposedPlans ?? [], childWorkEntries),
    [child?.proposedPlans, childMessages, childWorkEntries],
  );
  const nativeDetail = nativeDetailQuery.data;
  const nativeMessages = useMemo<ReadonlyArray<ChatMessage>>(
    () => nativeDetail?.messages ?? [],
    [nativeDetail?.messages],
  );
  const nativeWorkEntries = useMemo(
    () => deriveWorkLogEntries(nativeDetail?.activities ?? []),
    [nativeDetail?.activities],
  );
  const nativeTimelineEntries = useMemo(
    () =>
      deriveTimelineEntries(nativeMessages, nativeDetail?.proposedPlans ?? [], nativeWorkEntries),
    [nativeDetail?.proposedPlans, nativeMessages, nativeWorkEntries],
  );

  useEffect(() => {
    const knownRunning = props.nativeSummaries.some((summary) => summary.status === "running");
    const shouldPoll =
      knownRunning || (nativeSelected?.status === "unknown" && props.parentSessionActive);
    if (!shouldPoll) return;
    const interval = window.setInterval(() => {
      props.refreshNativeList();
      if (nativeSelected) nativeDetailQuery.refresh();
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [
    nativeDetailQuery.refresh,
    nativeSelected,
    props.nativeSummaries,
    props.parentSessionActive,
    props.refreshNativeList,
  ]);

  useEffect(() => {
    if (!nativeSelected || !props.parentUpdatedAt) return;
    const timeout = window.setTimeout(nativeDetailQuery.refresh, 250);
    return () => window.clearTimeout(timeout);
  }, [nativeDetailQuery.refresh, nativeSelected, props.parentUpdatedAt]);

  if (!selected && !nativeSelected) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto p-3"
        data-testid="agents-panel-list"
      >
        {sortedEntries.length === 0 && !props.nativePending && !props.nativeError ? (
          <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
            <Bot className="size-8 opacity-40" />
            <p className="text-sm">No delegated agents yet.</p>
            <p className="text-xs">Agents you delegate work to will appear here.</p>
          </div>
        ) : (
          <div className={props.maximized ? "grid grid-cols-2 gap-2" : "space-y-2"}>
            {sortedEntries.map((entry) => {
              if (entry.source === "native") {
                const summary = entry.summary;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setSelectedId(entry.key)}
                    aria-label={`Open ${summary.title} — ${nativeStatusLabel(summary)}`}
                    className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card p-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          summary.status === "running"
                            ? "bg-orange-500"
                            : summary.status === "error"
                              ? "bg-red-500"
                              : summary.status === "unknown"
                                ? "bg-muted-foreground/50"
                                : "bg-emerald-500",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {summary.title}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        Native · Read only
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {nativeStatusLabel(summary)}
                      {summary.model ? ` · ${summary.model}` : ""}
                      {summary.role ? ` · ${summary.role}` : ""}
                    </div>
                  </button>
                );
              }
              const summary = entry.summary;
              const context = subagentContextPercent(summary);
              const attention = subagentNeedsAttention(summary);
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setSelectedId(entry.key)}
                  aria-label={`Open ${summary.title} — ${subagentStatusLabel(summary)}`}
                  className={cn(
                    "flex flex-col gap-2.5 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40",
                    attention ? "border-amber-500/50 ring-1 ring-amber-500/30" : "border-border/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <StatusDot summary={summary} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
                      {summary.title}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      Managed
                    </span>
                    {attention ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        {summary.hasPendingApproval ? "Approval" : "Input"}
                      </span>
                    ) : null}
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {summary.displayId}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate rounded-md bg-muted/60 px-1.5 py-0.5 font-mono">
                        {summary.model}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Clock className="size-3" />
                        {formatElapsed(summary.createdAt, summary.settledAt)}
                      </span>
                      {summary.turnCount > 0 ? (
                        <span className="shrink-0">
                          · {summary.turnCount}
                          {summary.turnCount === 1 ? " turn" : " turns"}
                        </span>
                      ) : null}
                    </div>
                    {context !== null ? (
                      <ContextMeter
                        percent={context}
                        className="shrink-0 text-[11px] text-muted-foreground"
                      />
                    ) : null}
                  </div>
                  {summary.status === "error" && summary.error ? (
                    <div className="line-clamp-2 text-xs text-red-500">{summary.error}</div>
                  ) : null}
                </button>
              );
            })}
            {props.nativePending && props.nativeSummaries.length === 0 ? (
              <div className="rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
                Discovering native agents…
              </div>
            ) : null}
            {props.nativeError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                <div>Native agents are unavailable.</div>
                <button type="button" className="mt-2 underline" onClick={props.refreshNativeList}>
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  if (nativeSelected) {
    const running = nativeSelected.status === "running";
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="agents-panel-native-detail">
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            aria-label="Back to agents"
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{nativeSelected.title}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {nativeStatusLabel(nativeSelected)}
              {nativeSelected.provider ? ` · ${nativeSelected.provider}` : ""}
            </span>
          </div>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
            Native · Read only
          </span>
        </div>
        <div className="min-h-0 flex-1">
          {nativeDetail ? (
            <MessagesTimeline
              key={nativeSelected.id}
              isWorking={running}
              activeTurnInProgress={running}
              activeTurnStartedAt={nativeDetail.latestTurn?.startedAt ?? null}
              listRef={timelineListRef}
              timelineEntries={nativeTimelineEntries}
              latestTurn={nativeDetail.latestTurn}
              runningTurnId={running ? (nativeDetail.latestTurn?.turnId ?? null) : null}
              turnDiffSummaryByAssistantMessageId={EMPTY_CHILD_TURN_DIFF_SUMMARIES}
              routeThreadKey={`native:${props.parentThreadId ?? "unknown"}:${nativeSelected.id}`}
              onOpenTurnDiff={noop}
              revertTurnCountByUserMessageId={EMPTY_CHILD_REVERT_COUNTS}
              onRevertUserMessage={noop}
              isRevertingCheckpoint={false}
              onImageExpand={props.onImageExpand}
              activeThreadEnvironmentId={props.environmentId}
              markdownCwd={nativeSelected.cwd}
              resolvedTheme={props.resolvedTheme}
              timestampFormat={props.timestampFormat}
              workspaceRoot={nativeSelected.cwd ?? ""}
              anchorMessageId={null}
              onAnchorReady={noop}
              onAnchorSizeChanged={noop}
              contentInsetEndAdjustment={0}
              onIsAtEndChange={noop}
              onManualNavigation={noop}
            />
          ) : nativeDetailQuery.error ? (
            <div className="m-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
              <p>Native transcript is unavailable.</p>
              <button
                type="button"
                className="mt-2 text-primary underline"
                onClick={nativeDetailQuery.refresh}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Loading native transcript…</div>
          )}
        </div>
      </div>
    );
  }

  if (!selected) return null;

  const active = child?.session?.status === "starting" || child?.session?.status === "running";
  const pendingApproval = child ? (derivePendingApprovals(child.activities)[0] ?? null) : null;
  const requestId = pendingApproval?.requestId ?? null;
  const pendingUserInput = child ? (derivePendingUserInputs(child.activities)[0] ?? null) : null;
  const pendingAnswers = pendingUserInput
    ? buildPendingUserInputAnswers(pendingUserInput.questions, inputDrafts)
    : null;
  const selectedContext = subagentContextPercent(selected);
  const activeWorkStartedAt = child
    ? deriveActiveWorkStartedAt(child.latestTurn, child.session, null)
    : null;

  const submit = async () => {
    const text = draft.trim();
    if (!child || text.length === 0) return;
    setDraft("");
    await startTurn({
      environmentId: props.environmentId,
      input: {
        threadId: child.id,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection: child.modelSelection,
        runtimeMode: child.runtimeMode,
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1" data-testid="agents-panel-detail">
      {props.maximized ? (
        <aside className="w-72 shrink-0 space-y-1 overflow-auto border-r border-border/70 p-2">
          {sortedSummaries.map((summary) => (
            <button
              key={summary.threadId}
              type="button"
              onClick={() => setSelectedId(`managed:${summary.displayId}`)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md p-2 text-left",
                summary.displayId === selected.displayId ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <StatusDot summary={summary} />
              <span className="min-w-0 flex-1 truncate text-sm">{summary.title}</span>
              {subagentNeedsAttention(summary) ? (
                <span className="size-1.5 rounded-full bg-amber-500" />
              ) : null}
              <span className="font-mono text-[10px] text-muted-foreground">
                {summary.displayId}
              </span>
            </button>
          ))}
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          {!props.maximized ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Back to agents"
              className="rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <StatusDot summary={selected} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{selected.title}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {subagentStatusLabel(selected)} · {selected.provider}/{selected.model}
              {selectedContext !== null ? ` · ${selectedContext}% context` : ""}
            </span>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {selected.displayId}
          </span>
          {active && child ? (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Stop agent"
              onClick={() =>
                void interruptTurn({
                  environmentId: props.environmentId,
                  input: {
                    threadId: child.id,
                    ...(child.latestTurn ? { turnId: child.latestTurn.turnId } : {}),
                    createdAt: new Date().toISOString(),
                  },
                })
              }
            >
              <CircleStop className="size-4" />
            </button>
          ) : null}
        </div>
        {selected.status === "error" && selected.error ? (
          <div className="flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{selected.error}</span>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          {child && childRef ? (
            <MessagesTimeline
              key={child.id}
              isWorking={active}
              activeTurnInProgress={active || !isLatestTurnSettled(child.latestTurn, child.session)}
              activeTurnStartedAt={activeWorkStartedAt}
              listRef={timelineListRef}
              timelineEntries={childTimelineEntries}
              latestTurn={child.latestTurn}
              runningTurnId={
                child.session?.status === "running" ? child.session.activeTurnId : null
              }
              turnDiffSummaryByAssistantMessageId={EMPTY_CHILD_TURN_DIFF_SUMMARIES}
              routeThreadKey={scopedThreadKey(childRef)}
              onOpenTurnDiff={noop}
              revertTurnCountByUserMessageId={EMPTY_CHILD_REVERT_COUNTS}
              onRevertUserMessage={noop}
              isRevertingCheckpoint={false}
              onImageExpand={props.onImageExpand}
              activeThreadEnvironmentId={props.environmentId}
              markdownCwd={selected.cwd}
              resolvedTheme={props.resolvedTheme}
              timestampFormat={props.timestampFormat}
              workspaceRoot={selected.cwd}
              anchorMessageId={null}
              onAnchorReady={noop}
              onAnchorSizeChanged={noop}
              contentInsetEndAdjustment={0}
              onIsAtEndChange={noop}
              onManualNavigation={noop}
            />
          ) : null}
        </div>
        {requestId ? (
          <div className="flex gap-2 border-t border-border/70 p-2">
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
              onClick={() =>
                void respondToApproval({
                  environmentId: props.environmentId,
                  input: {
                    threadId: selected.threadId,
                    requestId,
                    decision: "accept",
                    createdAt: new Date().toISOString(),
                  },
                })
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded bg-muted px-3 py-1 text-xs"
              onClick={() =>
                void respondToApproval({
                  environmentId: props.environmentId,
                  input: {
                    threadId: selected.threadId,
                    requestId,
                    decision: "decline",
                    createdAt: new Date().toISOString(),
                  },
                })
              }
            >
              Decline
            </button>
          </div>
        ) : null}
        {pendingUserInput && child ? (
          <div className="space-y-3 border-t border-border/70 p-3">
            <div className="text-xs font-semibold">Input needed</div>
            {pendingUserInput.questions.map((question) => {
              const selectedOptionLabels = new Set(
                inputDrafts[question.id]?.selectedOptionLabels ?? [],
              );
              return (
                <div key={question.id} className="space-y-2">
                  <div className="text-sm">{question.question}</div>
                  <div className="flex flex-wrap gap-2">
                    {question.options.map((option) => {
                      const selected = selectedOptionLabels.has(option.label);
                      return (
                        <button
                          key={option.label}
                          type="button"
                          className={
                            selected
                              ? "rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground"
                              : "rounded-full bg-muted px-3 py-1 text-xs"
                          }
                          onClick={() =>
                            setInputDrafts((current) => ({
                              ...current,
                              [question.id]: togglePendingUserInputOptionSelection(
                                question,
                                current[question.id],
                                option.label,
                              ),
                            }))
                          }
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <label
                    htmlFor={`subagent-input-${pendingUserInput.requestId}-${question.id}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Custom answer
                  </label>
                  <input
                    id={`subagent-input-${pendingUserInput.requestId}-${question.id}`}
                    value={inputDrafts[question.id]?.customAnswer ?? ""}
                    onChange={(event) =>
                      setInputDrafts((current) => ({
                        ...current,
                        [question.id]: setPendingUserInputCustomAnswer(
                          current[question.id],
                          event.target.value,
                        ),
                      }))
                    }
                    placeholder="Or type a custom answer"
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                </div>
              );
            })}
            <button
              type="button"
              disabled={!pendingAnswers}
              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
              onClick={() => {
                if (!pendingAnswers) return;
                void respondToUserInput({
                  environmentId: props.environmentId,
                  input: {
                    threadId: child.id,
                    requestId: pendingUserInput.requestId,
                    answers: pendingAnswers,
                    createdAt: new Date().toISOString(),
                  },
                });
              }}
            >
              Submit answers
            </button>
          </div>
        ) : null}
        <div className="flex gap-2 border-t border-border/70 p-2">
          <textarea
            aria-label={active ? "Steer this agent run" : "Continue this agent"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={active ? "Steer this run…" : "Continue this agent…"}
            className="min-h-9 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void submit()}
            aria-label="Send to agent"
            disabled={draft.trim().length === 0}
            className="self-end rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

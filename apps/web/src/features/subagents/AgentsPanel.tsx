import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import {
  normalizeSubagentTranscript,
  subagentContextPercent,
} from "@t3tools/fork-subagents/presentation";
import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId } from "@t3tools/contracts";
import { AlertTriangle, ArrowLeft, Bot, CircleStop, Clock, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useThreadDetail } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn, newMessageId } from "../../lib/utils";
import { derivePendingApprovals, derivePendingUserInputs } from "../../session-logic";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { subagentStatusColor } from "./subagentStatusColor";

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

// Running and attention-needing agents float to the top so they are never buried.
function sortSummaries(summaries: ReadonlyArray<SubagentSummary>): ReadonlyArray<SubagentSummary> {
  const rank = (summary: SubagentSummary): number =>
    subagentNeedsAttention(summary) ? 0 : summary.status === "running" ? 1 : 2;
  return [...summaries].sort((a, b) => rank(a) - rank(b));
}

interface CollapsedActivity {
  readonly id: string;
  readonly summary: string;
  readonly count: number;
}

// Fold runs of identical summaries (e.g. repeated "Context window updated") into one row.
function collapseActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<CollapsedActivity> {
  const out: Array<{ id: string; summary: string; count: number }> = [];
  for (const activity of activities) {
    const last = out[out.length - 1];
    if (last && last.summary === activity.summary) {
      last.count += 1;
      continue;
    }
    out.push({ id: activity.id, summary: activity.summary, count: 1 });
  }
  return out;
}

function StatusDot(props: { readonly summary: SubagentSummary }) {
  // Only surface attention-worthy states: orange for running, red for error.
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
  readonly maximized: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = props.summaries.find((summary) => summary.displayId === selectedId) ?? null;
  const childRef = selected ? scopeThreadRef(props.environmentId, selected.threadId) : null;
  const child = useThreadDetail(childRef);
  const transcript = child ? normalizeSubagentTranscript(child) : null;
  const summaries = child
    ? foldSubagentSummaries(child.activities, props.summaries)
    : props.summaries;
  const sortedSummaries = useMemo(() => sortSummaries(summaries), [summaries]);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageCount = transcript?.messages.length ?? 0;
  const activityCount = transcript?.activities.length ?? 0;
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [selectedId, messageCount, activityCount]);

  if (!selected) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto p-3"
        data-testid="agents-panel-list"
      >
        <div className="mb-3 flex items-center gap-2 px-1">
          <Bot className="size-4" />
          <h2 className="text-sm font-semibold">Delegated agents</h2>
          <span className="ml-auto text-xs text-muted-foreground">{summaries.length}</span>
        </div>
        {summaries.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
            <Bot className="size-8 opacity-40" />
            <p className="text-sm">No delegated agents yet.</p>
            <p className="text-xs">Agents you delegate work to will appear here.</p>
          </div>
        ) : (
          <div className={props.maximized ? "grid grid-cols-2 gap-2" : "space-y-2"}>
            {sortedSummaries.map((summary) => {
              const context = subagentContextPercent(summary);
              const attention = subagentNeedsAttention(summary);
              return (
                <button
                  key={summary.threadId}
                  type="button"
                  onClick={() => setSelectedId(summary.displayId)}
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
          </div>
        )}
      </div>
    );
  }

  const active = child?.session?.status === "starting" || child?.session?.status === "running";
  const pendingApproval = child ? (derivePendingApprovals(child.activities)[0] ?? null) : null;
  const requestId = pendingApproval?.requestId ?? null;
  const pendingUserInput = child ? (derivePendingUserInputs(child.activities)[0] ?? null) : null;
  const pendingAnswers = pendingUserInput
    ? buildPendingUserInputAnswers(pendingUserInput.questions, inputDrafts)
    : null;
  const collapsedActivities = transcript
    ? collapseActivities(transcript.activities.slice(-20))
    : [];
  const selectedContext = subagentContextPercent(selected);
  const hasTranscript = (transcript?.messages.length ?? 0) > 0 || collapsedActivities.length > 0;

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
              onClick={() => setSelectedId(summary.displayId)}
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
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {!hasTranscript ? (
            <div className="pt-8 text-center text-xs text-muted-foreground">
              {active ? "Waiting for the agent to respond…" : "No activity yet."}
            </div>
          ) : null}
          {transcript?.messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "ml-8" : "mr-8"}>
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {message.role}
              </div>
              <div className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm">
                {message.text}
              </div>
            </div>
          ))}
          {collapsedActivities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-2 px-2 text-xs text-muted-foreground"
            >
              <span className="h-px flex-1 bg-border/60" />
              <span>
                {activity.summary}
                {activity.count > 1 ? ` ×${activity.count}` : ""}
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </div>
          ))}
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

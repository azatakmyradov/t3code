import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import { subagentContextPercent } from "@t3tools/fork-subagents/presentation";
import { type LegendListRef } from "@legendapp/list/react-native";
import { deriveActiveWorkStartedAt } from "@t3tools/shared/orchestrationTiming";
import {
  MessageId,
  type ApprovalRequestId,
  type EnvironmentId,
  type NativeHarnessSubagentSummary,
  type ProviderApprovalDecision,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";

import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadDetail } from "../../state/use-thread-detail";
import { threadEnvironment } from "../../state/threads";
import { nativeSubagentEnvironment } from "../../state/nativeSubagents";
import { useEnvironmentQuery } from "../../state/query";
import {
  buildThreadFeed,
  buildPendingUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
} from "../../lib/threadActivity";
import { uuidv4 } from "../../lib/uuid";
import { PendingApprovalCard } from "../threads/PendingApprovalCard";
import { PendingUserInputCard } from "../threads/PendingUserInputCard";
import { ThreadFeed } from "../threads/ThreadFeed";

const READY_THREAD_CONTENT_PRESENTATION = { kind: "ready" } as const;

function formatElapsed(createdAt: string, settledAt: string | null): string {
  const milliseconds = Math.max(
    0,
    Date.parse(settledAt ?? new Date().toISOString()) - Date.parse(createdAt),
  );
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return `${Math.floor(milliseconds / 1_000)}s`;
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function SubagentSummaryRow(props: {
  readonly summary: SubagentSummary;
  readonly onOpen: (displayId: string) => void;
}) {
  const context = subagentContextPercent(props.summary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${props.summary.title}`}
      onPress={() => props.onOpen(props.summary.displayId)}
      className="border-border bg-card rounded-xl border p-3"
    >
      <View className="flex-row items-center gap-2">
        <View
          className={
            props.summary.status === "running"
              ? "size-2 rounded-full bg-sky-500"
              : props.summary.status === "error"
                ? "size-2 rounded-full bg-red-500"
                : "size-2 rounded-full bg-emerald-500"
          }
        />
        <Text className="text-foreground flex-1 font-medium" numberOfLines={1}>
          {props.summary.title}
        </Text>
        <Text className="text-muted-foreground font-mono text-xs">{props.summary.displayId}</Text>
        <Text className="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-[10px]">
          Managed
        </Text>
      </View>
      <Text className="text-muted-foreground mt-2 text-xs" numberOfLines={1}>
        {props.summary.provider}/{props.summary.model} ·{" "}
        {formatElapsed(props.summary.createdAt, props.summary.settledAt)}
        {context === null ? "" : ` · ${context}% context`}
      </Text>
      <Text className="text-muted-foreground mt-1 font-mono text-xs" numberOfLines={1}>
        {props.summary.cwd}
      </Text>
    </Pressable>
  );
}

function NativeSummaryRow(props: {
  readonly summary: NativeHarnessSubagentSummary;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${props.summary.title}`}
      onPress={() => props.onOpen(props.summary.id)}
      className="border-border bg-card rounded-xl border p-3"
    >
      <View className="flex-row items-center gap-2">
        <View
          className={
            props.summary.status === "running"
              ? "size-2 rounded-full bg-sky-500"
              : props.summary.status === "error"
                ? "size-2 rounded-full bg-red-500"
                : props.summary.status === "unknown"
                  ? "bg-muted-foreground size-2 rounded-full"
                  : "size-2 rounded-full bg-emerald-500"
          }
        />
        <Text className="text-foreground flex-1 font-medium" numberOfLines={1}>
          {props.summary.title}
        </Text>
        <Text className="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-[10px]">
          Native · Read only
        </Text>
      </View>
      <Text className="text-muted-foreground mt-2 text-xs" numberOfLines={1}>
        {props.summary.status === "unknown" ? "Status unavailable" : props.summary.status}
        {props.summary.model ? ` · ${props.summary.model}` : ""}
      </Text>
      {props.summary.cwd ? (
        <Text className="text-muted-foreground mt-1 font-mono text-xs" numberOfLines={1}>
          {props.summary.cwd}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SubagentsInspector(props: {
  readonly environmentId: EnvironmentId;
  readonly summaries: ReadonlyArray<SubagentSummary>;
  readonly nativeSummaries: ReadonlyArray<NativeHarnessSubagentSummary>;
  readonly nativePending: boolean;
  readonly nativeError: string | null;
  readonly parentThreadId: ThreadId | null;
  readonly parentUpdatedAt: string | null;
  readonly parentSessionActive: boolean;
  readonly refreshNativeList: () => void;
  readonly headerInset: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inputDrafts, setInputDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [respondingApprovalId, setRespondingApprovalId] = useState<ApprovalRequestId | null>(null);
  const [respondingUserInputId, setRespondingUserInputId] = useState<ApprovalRequestId | null>(
    null,
  );
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
  const childState = useThreadDetail({
    environmentId: selected ? props.environmentId : null,
    threadId: selected?.threadId ?? null,
  });
  const child = Option.getOrNull(childState.data);
  const summaries = useMemo(
    () => (child ? foldSubagentSummaries(child.activities, props.summaries) : props.summaries),
    [child, props.summaries],
  );
  const feed = useMemo(() => (child ? buildThreadFeed(child) : []), [child]);
  const nativeFeed = useMemo(
    () => (nativeDetailQuery.data ? buildThreadFeed(nativeDetailQuery.data) : []),
    [nativeDetailQuery.data],
  );
  const childSessionActivity = useMemo(
    () =>
      child?.session
        ? {
            orchestrationStatus: child.session.status,
            activeTurnId: child.session.activeTurnId ?? undefined,
          }
        : null,
    [child?.session],
  );
  const activeWorkStartedAt = useMemo(
    () => (child ? deriveActiveWorkStartedAt(child.latestTurn, childSessionActivity, null) : null),
    [child, childSessionActivity],
  );
  const listRef = useRef<LegendListRef | null>(null);
  const freeze = useSharedValue(false);
  const contentInsetEndAdjustment = useSharedValue(0);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, "continue subagent");
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, "interrupt subagent");
  const respondToApproval = useAtomCommand(
    threadEnvironment.respondToApproval,
    "subagent approval response",
  );
  const respondToUserInput = useAtomCommand(
    threadEnvironment.respondToUserInput,
    "subagent user input response",
  );
  const openSummary = useCallback((displayId: string) => setSelectedId(`managed:${displayId}`), []);
  const openNativeSummary = useCallback(
    (nativeId: string) => setSelectedId(`native:${nativeId}`),
    [],
  );
  const listEntries = useMemo(
    () =>
      [
        ...summaries.map((summary) => ({
          key: `managed:${summary.displayId}`,
          source: "managed" as const,
          rank:
            summary.hasPendingApproval || summary.hasPendingUserInput
              ? 0
              : summary.status === "running"
                ? 1
                : 2,
          summary,
        })),
        ...props.nativeSummaries.map((summary) => ({
          key: `native:${summary.id}`,
          source: "native" as const,
          rank: summary.status === "running" ? 1 : 2,
          summary,
        })),
      ].sort((a, b) => a.rank - b.rank),
    [props.nativeSummaries, summaries],
  );
  const renderListEntry = useCallback(
    ({ item }: { readonly item: (typeof listEntries)[number] }) =>
      item.source === "managed" ? (
        <SubagentSummaryRow summary={item.summary} onOpen={openSummary} />
      ) : (
        <NativeSummaryRow summary={item.summary} onOpen={openNativeSummary} />
      ),
    [listEntries, openNativeSummary, openSummary],
  );

  useEffect(() => {
    const knownRunning = props.nativeSummaries.some((summary) => summary.status === "running");
    const shouldPoll =
      knownRunning || (nativeSelected?.status === "unknown" && props.parentSessionActive);
    if (!shouldPoll) return;
    const interval = setInterval(() => {
      props.refreshNativeList();
      if (nativeSelected) nativeDetailQuery.refresh();
    }, 1_000);
    return () => clearInterval(interval);
  }, [
    nativeDetailQuery.refresh,
    nativeSelected,
    props.nativeSummaries,
    props.parentSessionActive,
    props.refreshNativeList,
  ]);

  useEffect(() => {
    if (!nativeSelected || !props.parentUpdatedAt) return;
    const timeout = setTimeout(nativeDetailQuery.refresh, 250);
    return () => clearTimeout(timeout);
  }, [nativeDetailQuery.refresh, nativeSelected, props.parentUpdatedAt]);

  if (!selected && !nativeSelected) {
    return (
      <View className="bg-screen flex-1" style={{ paddingTop: props.headerInset }}>
        <FlatList
          data={listEntries}
          keyExtractor={(entry) => entry.key}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          ListHeaderComponent={
            <Text className="text-foreground mb-1 text-base font-semibold">Agents</Text>
          }
          renderItem={renderListEntry}
          ListFooterComponent={
            props.nativePending || props.nativeError ? (
              <View className="border-border mt-2 rounded-xl border p-3">
                <Text className="text-muted-foreground text-sm">
                  {props.nativeError
                    ? "Native agents are unavailable."
                    : "Discovering native agents…"}
                </Text>
                {props.nativeError ? (
                  <Pressable accessibilityRole="button" onPress={props.refreshNativeList}>
                    <Text className="text-primary mt-2">Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null
          }
        />
      </View>
    );
  }

  if (nativeSelected) {
    const detail = nativeDetailQuery.data;
    return (
      <View className="bg-screen flex-1" style={{ paddingTop: props.headerInset }}>
        <View className="border-border flex-row items-center gap-3 border-b px-3 py-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to agents"
            onPress={() => setSelectedId(null)}
          >
            <Text className="text-primary text-base">‹ Agents</Text>
          </Pressable>
          <Text className="text-foreground flex-1 font-semibold" numberOfLines={1}>
            {nativeSelected.title}
          </Text>
          <Text className="text-muted-foreground bg-muted rounded-full px-2 py-1 text-[10px]">
            Native · Read only
          </Text>
        </View>
        <View className="flex-1">
          {detail && props.parentThreadId ? (
            <ThreadFeed
              key={nativeSelected.id}
              environmentId={props.environmentId}
              threadId={props.parentThreadId}
              workspaceRoot={nativeSelected.cwd ?? ""}
              feed={nativeFeed}
              contentPresentation={READY_THREAD_CONTENT_PRESENTATION}
              agentLabel={`${nativeSelected.provider} native agent`}
              latestTurn={detail.latestTurn}
              activeWorkStartedAt={detail.latestTurn?.startedAt ?? null}
              listRef={listRef}
              freeze={freeze}
              anchorMessageId={null}
              contentInsetEndAdjustment={contentInsetEndAdjustment}
              contentTopInset={0}
              contentBottomInset={12}
            />
          ) : nativeDetailQuery.error ? (
            <View className="m-4 gap-3">
              <Text className="text-foreground">Native transcript is unavailable.</Text>
              <Pressable accessibilityRole="button" onPress={nativeDetailQuery.refresh}>
                <Text className="text-primary">Retry</Text>
              </Pressable>
            </View>
          ) : (
            <Text className="text-muted-foreground p-4">Loading native transcript…</Text>
          )}
        </View>
      </View>
    );
  }

  if (!selected) return null;

  const active = child?.session?.status === "starting" || child?.session?.status === "running";
  const pendingApproval = child ? (derivePendingApprovals(child.activities)[0] ?? null) : null;
  const pendingUserInput = child ? (derivePendingUserInputs(child.activities)[0] ?? null) : null;
  const pendingAnswers = pendingUserInput
    ? buildPendingUserInputAnswers(pendingUserInput.questions, inputDrafts)
    : null;
  const onRespondToApproval = async (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => {
    if (!child) return;
    setRespondingApprovalId(requestId);
    const result = await respondToApproval({
      environmentId: props.environmentId,
      input: { threadId: child.id, requestId, decision },
    });
    setRespondingApprovalId(null);
    return result;
  };
  const onSubmitUserInput = async () => {
    if (!child || !pendingUserInput || !pendingAnswers) return;
    setRespondingUserInputId(pendingUserInput.requestId);
    const result = await respondToUserInput({
      environmentId: props.environmentId,
      input: {
        threadId: child.id,
        requestId: pendingUserInput.requestId,
        answers: pendingAnswers,
      },
    });
    setRespondingUserInputId(null);
    return result;
  };
  const submit = () => {
    const text = draft.trim();
    if (!child || text.length === 0) return;
    setDraft("");
    void startTurn({
      environmentId: props.environmentId,
      input: {
        threadId: child.id,
        message: {
          messageId: MessageId.make(uuidv4()),
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
    <View className="bg-screen flex-1" style={{ paddingTop: props.headerInset }}>
      <View className="border-border flex-row items-center gap-3 border-b px-3 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to agents"
          onPress={() => setSelectedId(null)}
        >
          <Text className="text-primary text-base">‹ Agents</Text>
        </Pressable>
        <Text className="text-foreground flex-1 font-semibold" numberOfLines={1}>
          {selected.title}
        </Text>
        {active && child ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop agent"
            onPress={() =>
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
            <Text className="text-red-500">Stop</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="flex-1">
        {child ? (
          <ThreadFeed
            key={child.id}
            environmentId={props.environmentId}
            threadId={child.id}
            workspaceRoot={selected.cwd}
            feed={feed}
            contentPresentation={READY_THREAD_CONTENT_PRESENTATION}
            agentLabel={`${child.modelSelection.instanceId} agent`}
            latestTurn={child.latestTurn}
            activeWorkStartedAt={activeWorkStartedAt}
            listRef={listRef}
            freeze={freeze}
            anchorMessageId={null}
            contentInsetEndAdjustment={contentInsetEndAdjustment}
            contentTopInset={0}
            contentBottomInset={12}
          />
        ) : null}
      </View>
      {pendingApproval || pendingUserInput ? (
        <View className="border-border gap-3 border-t p-3">
          {pendingApproval ? (
            <PendingApprovalCard
              approval={pendingApproval}
              respondingApprovalId={respondingApprovalId}
              onRespond={onRespondToApproval}
            />
          ) : null}
          {pendingUserInput ? (
            <PendingUserInputCard
              pendingUserInput={pendingUserInput}
              drafts={inputDrafts}
              answers={pendingAnswers}
              respondingUserInputId={respondingUserInputId}
              onSelectOption={(_requestId, questionId, label) =>
                setInputDrafts((current) => ({
                  ...current,
                  [questionId]: { selectedOptionLabel: label },
                }))
              }
              onChangeCustomAnswer={(_requestId, questionId, customAnswer) =>
                setInputDrafts((current) => ({
                  ...current,
                  [questionId]: setPendingUserInputCustomAnswer(current[questionId], customAnswer),
                }))
              }
              onSubmit={onSubmitUserInput}
            />
          ) : null}
        </View>
      ) : null}
      <View className="border-border flex-row items-end gap-2 border-t p-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={active ? "Steer this run…" : "Continue this agent…"}
          placeholderTextColor="#888"
          multiline
          className="border-border text-foreground min-h-10 flex-1 rounded-xl border px-3 py-2"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send to agent"
          onPress={submit}
          className="bg-primary rounded-xl px-4 py-3"
        >
          <Text className="text-primary-foreground font-medium">Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

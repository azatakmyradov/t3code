import { foldSubagentSummaries } from "@t3tools/fork-subagents/activities";
import type { SubagentSummary } from "@t3tools/fork-subagents/contracts";
import {
  normalizeSubagentTranscript,
  subagentContextPercent,
} from "@t3tools/fork-subagents/presentation";
import {
  MessageId,
  type ApprovalRequestId,
  type EnvironmentId,
  type ProviderApprovalDecision,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadDetail } from "../../state/use-thread-detail";
import { threadEnvironment } from "../../state/threads";
import {
  buildPendingUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
} from "../../lib/threadActivity";
import { uuidv4 } from "../../lib/uuid";
import { PendingApprovalCard } from "../threads/PendingApprovalCard";
import { PendingUserInputCard } from "../threads/PendingUserInputCard";

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

export function SubagentsInspector(props: {
  readonly environmentId: EnvironmentId;
  readonly summaries: ReadonlyArray<SubagentSummary>;
  readonly headerInset: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inputDrafts, setInputDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [respondingApprovalId, setRespondingApprovalId] = useState<ApprovalRequestId | null>(null);
  const [respondingUserInputId, setRespondingUserInputId] = useState<ApprovalRequestId | null>(
    null,
  );
  const selected = props.summaries.find((summary) => summary.displayId === selectedId) ?? null;
  const childState = useThreadDetail({
    environmentId: selected ? props.environmentId : null,
    threadId: selected?.threadId ?? null,
  });
  const child = Option.getOrNull(childState.data);
  const transcript = child ? normalizeSubagentTranscript(child) : null;
  const summaries = useMemo(
    () => (child ? foldSubagentSummaries(child.activities, props.summaries) : props.summaries),
    [child, props.summaries],
  );
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
  const openSummary = useCallback((displayId: string) => setSelectedId(displayId), []);
  const renderSummary = useCallback(
    ({ item }: { readonly item: SubagentSummary }) => (
      <SubagentSummaryRow summary={item} onOpen={openSummary} />
    ),
    [openSummary],
  );

  if (!selected) {
    return (
      <View className="bg-screen flex-1" style={{ paddingTop: props.headerInset }}>
        <FlatList
          data={summaries}
          keyExtractor={(summary) => summary.threadId}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          ListHeaderComponent={
            <Text className="text-foreground mb-1 text-base font-semibold">Agents</Text>
          }
          renderItem={renderSummary}
        />
      </View>
    );
  }

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
      <ScrollView className="flex-1" contentContainerClassName="gap-3 p-3">
        {transcript?.messages.map((message) => (
          <View key={message.id} className="bg-muted rounded-xl p-3">
            <Text className="text-muted-foreground mb-1 text-[10px] uppercase">{message.role}</Text>
            <Text className="text-foreground text-sm">{message.text}</Text>
          </View>
        ))}
        {transcript?.activities
          .filter(
            (activity) =>
              activity.kind !== "approval.requested" &&
              activity.kind !== "user-input.requested" &&
              activity.kind !== "approval.resolved" &&
              activity.kind !== "user-input.resolved",
          )
          .slice(-20)
          .map((activity) => (
            <View key={activity.id} className="border-border rounded-xl border px-3 py-2">
              <Text className="text-muted-foreground text-xs">{activity.summary}</Text>
            </View>
          ))}
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
      </ScrollView>
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

import { useNavigation } from "@react-navigation/native";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { BotNavigationThread, BotSummary, EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { use, useMemo, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPill, ControlPillMenu } from "../../components/ControlPill";
import { RowPressable } from "../../components/RowPressable";
import { cn } from "../../lib/cn";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { botNavigationAtom } from "../../state/bots";
import { useEnvironments } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { useAtomValueWhileVisible, useHomeRouteVisible } from "../home/home-route-visibility";
import { useHomeThreadSelection } from "../home/home-thread-navigation";
import { ThreadListV2SectionDivider } from "../threads/thread-list-v2-items";
import { selectedThreadRowColors } from "../threads/thread-list-v2-row-appearance";
import { createBotActivityAtom } from "./botActivity";

const COLLAPSED_BOT_COUNT = 6;
const STATUS_CLASS_NAME: Partial<Record<string, string>> = {
  Working: "text-info-foreground",
  "Approval needed": "text-warning-foreground",
  "Awaiting input": "text-advisory-foreground",
};

/** Whether any environment supports bots. Home leaves the section out otherwise. */
export const botsAvailableAtom = Atom.make((get) => {
  for (const config of get(environmentServerConfigsAtom).values()) {
    if (config.environment.capabilities.bots === true) return true;
  }
  return false;
});

export function HomeBotsSection({
  environmentId,
  searchQuery,
}: {
  environmentId: EnvironmentId | null;
  searchQuery: string;
}) {
  const navigation = useNavigation();
  const primaryColumn = use(NativePrimaryColumnContext);
  const visible = useHomeRouteVisible();
  const entries = useAtomValueWhileVisible(botNavigationAtom, visible);
  const selectThread = useHomeThreadSelection();
  const { environments } = useEnvironments();
  const [expanded, setExpanded] = useState(false);
  const query = searchQuery.trim().toLocaleLowerCase();
  const matching = entries.filter(
    ({ bot }) =>
      (environmentId === null || bot.environmentId === environmentId) &&
      bot.name.toLocaleLowerCase().includes(query),
  );
  if (query && matching.length === 0) return null;
  return (
    <View className="mb-2">
      <View className="flex-row items-center">
        <View className="flex-1">
          <ThreadListV2SectionDivider label="Bots" pane={primaryColumn ? "sidebar" : "screen"} />
        </View>
        <View className="mr-3 mt-2">
          <ControlPill
            icon="plus"
            accessibilityLabel="New bot"
            onPress={() =>
              navigation.navigate("Bots", {
                ...(environmentId ? { environmentId } : {}),
                create: true,
              })
            }
          />
        </View>
      </View>
      {matching
        .slice(0, expanded ? matching.length : COLLAPSED_BOT_COUNT)
        .map(({ bot, threads }) => {
          const environment = environments.find((env) => env.environmentId === bot.environmentId);
          return (
            <HomeBotRow
              key={`${bot.environmentId}:${bot.id}`}
              bot={bot}
              threads={threads}
              environmentLabel={environment?.label ?? "Environment"}
              online={environment?.connection.phase === "connected"}
              visible={visible}
              sidebar={primaryColumn !== null}
              selectedThreadKey={primaryColumn?.selectedThreadKey ?? null}
              onOpen={() => selectThread({ environmentId: bot.environmentId, id: bot.threadId })}
              onOpenSettings={() =>
                navigation.navigate("Bots", { environmentId: bot.environmentId, botId: bot.id })
              }
            />
          );
        })}
      {matching.length === 0 ? (
        <Text className="px-4 py-2 text-sm text-foreground-muted">
          Create a bot, then teach it through chat.
        </Text>
      ) : null}
      {matching.length > COLLAPSED_BOT_COUNT ? (
        <View className="mx-4 mt-2 self-start">
          <ControlPill
            variant="pill"
            label={expanded ? "Show fewer bots" : "Show all bots"}
            onPress={() => setExpanded(!expanded)}
          />
        </View>
      ) : null}
    </View>
  );
}

function HomeBotRow({
  bot,
  threads,
  environmentLabel,
  online,
  visible,
  sidebar,
  selectedThreadKey,
  onOpen,
  onOpenSettings,
}: {
  bot: BotSummary;
  threads: ReadonlyArray<BotNavigationThread>;
  environmentLabel: string;
  online: boolean;
  visible: boolean;
  sidebar: boolean;
  selectedThreadKey: string | null;
  onOpen: () => void;
  onOpenSettings: () => void;
}) {
  const refs = useMemo(
    () => [
      scopeThreadRef(bot.environmentId, bot.threadId),
      ...threads.map((thread) => scopeThreadRef(thread.environmentId, thread.threadId)),
    ],
    [bot.environmentId, bot.threadId, threads],
  );
  const activityAtom = useMemo(
    () => createBotActivityAtom(refs, environmentThreadShells.threadShellAtom),
    [refs],
  );
  const activity = useAtomValueWhileVisible(activityAtom, visible);
  const status = bot.paused ? "Paused" : online ? activity : "Offline";
  const selected =
    selectedThreadKey !== null && refs.some((ref) => scopedThreadKey(ref) === selectedThreadKey);
  return (
    <ControlPillMenu
      shouldOpenOnLongPress
      actions={[
        { id: "chat", title: "Main conversation", image: "text.bubble" },
        { id: "details", title: "Threads & bot settings", image: "slider.horizontal.3" },
      ]}
      onPressAction={({ nativeEvent }) =>
        nativeEvent.event === "chat" ? onOpen() : onOpenSettings()
      }
    >
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`${bot.name}, ${status}`}
        accessibilityHint="Opens the main conversation. Touch and hold for bot settings."
        onPress={onOpen}
        className={cn(
          "mx-2 flex-row items-center gap-3 rounded-lg px-2 py-3",
          selected && "bg-thread-selected",
        )}
        interactionClassName={sidebar ? "bg-thread-hover" : "bg-row-hover"}
        interactionOpacity={selected ? 0 : 1}
      >
        <SymbolView
          name="brain"
          size={22}
          tintColorClassName={selected ? selectedThreadRowColors.iconTintClassName : "accent-icon"}
        />
        <View className="min-w-0 flex-1 gap-1">
          <Text
            className={cn(
              "text-base font-t3-medium",
              selected
                ? selectedThreadRowColors.foregroundClassName
                : sidebar
                  ? "text-drawer-foreground"
                  : "text-foreground",
            )}
            numberOfLines={1}
          >
            {bot.name}
          </Text>
          <Text
            className={cn(
              "text-xs",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : sidebar
                  ? "text-drawer-foreground-muted"
                  : "text-foreground-muted",
            )}
            numberOfLines={1}
          >
            {environmentLabel}
          </Text>
        </View>
        <Text
          className={cn(
            "text-xs",
            selected
              ? selectedThreadRowColors.mutedForegroundClassName
              : (STATUS_CLASS_NAME[status] ?? "text-foreground-muted"),
          )}
        >
          {status}
        </Text>
        <SymbolView name="chevron.right" size={12} tintColorClassName="accent-chevron" />
      </RowPressable>
    </ControlPillMenu>
  );
}

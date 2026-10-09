import { StackActions, useNavigation } from "@react-navigation/native";
import { useMemo } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenHeaderButton } from "../../components/ScreenHeaderButton";
import type { ScreenHeaderAction } from "../../components/ScreenHeader.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { useBotForThread } from "../../state/bots";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { Keyboard } from "react-native";

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const navigation = useNavigation();
  const { layout, panes, toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  const { onOpenTerminal, onMergeBack } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const botEntry = useBotForThread(ThreadId.make(props.gitControls.threadId));
  const androidHeaderActions = useMemo<ReadonlyArray<ScreenHeaderAction>>(() => {
    const actions: ScreenHeaderAction[] = [];
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: "Return to chat",
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      actions.push({
        accessibilityLabel: filesVisible ? "Close files" : "Open files",
        selected: filesVisible,
        icon: "folder",
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    if (props.hasWorkspaceRoot && props.gitControls.canOpenTerminal) {
      actions.push({
        accessibilityLabel: "Open terminal",
        icon: "terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    actions.push({
      accessibilityLabel: "Open git controls",
      icon: "point.topleft.down.curvedto.point.bottomright.up",
      onPress: props.onOpenGitInspector,
    });
    if (onMergeBack) {
      actions.push({
        accessibilityLabel: "Merge back to source",
        icon: "arrow.triangle.merge",
        onPress: onMergeBack,
      });
    }
    return actions;
  }, [
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    onOpenTerminal,
    onMergeBack,
    props.onOpenGitInspector,
    toggleAuxiliaryPane,
    props.onReturnToThread,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
    props.gitControls.canOpenTerminal,
  ]);

  // Only the main conversation is the bot's own; task threads work in real projects
  // and keep the regular header with its git, files, and terminal controls.
  const mainBot =
    botEntry?.bot.environmentId === props.gitControls.environmentId &&
    botEntry.bot.threadId === props.gitControls.threadId
      ? botEntry
      : null;
  if (mainBot) {
    const { bot, threads } = mainBot;
    const openThread = (environmentId: EnvironmentId, threadId: ThreadId) => {
      Keyboard.dismiss();
      navigation.navigate("Thread", { environmentId, threadId });
    };
    // The bot workspace has no git or files; its header lists the bot's threads and settings.
    return (
      <ScreenHeader
        title={bot.name}
        subtitle={bot.paused ? "Paused" : "Main conversation"}
        sidebar={false}
        hideBottomBorder
        options={{
          headerTitle: bot.name,
          // Keep the thread's left items: the split-view sidebar toggle, and the Home escape when
          // a deep link or cold start leaves no back button.
          headerBackVisible: native.options.headerBackVisible,
          unstable_headerLeftItems: native.options.unstable_headerLeftItems,
          unstable_headerRightItems: undefined,
        }}
        onBack={() => {
          Keyboard.dismiss();
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.dispatch(StackActions.replace("Home"));
        }}
        menus={[
          {
            title: `${bot.name} threads`,
            icon: "ellipsis",
            items: [
              ...threads.slice(0, 10).map((thread) => ({
                id: `${thread.environmentId}:${thread.threadId}`,
                title: thread.title,
                icon: "text.bubble",
                onPress: () => openThread(thread.environmentId, thread.threadId),
              })),
              {
                id: "settings",
                title: "Threads & bot settings",
                icon: "slider.horizontal.3",
                onPress: () => {
                  Keyboard.dismiss();
                  navigation.navigate("Bots", { environmentId: bot.environmentId, botId: bot.id });
                },
              },
            ],
          },
        ]}
      />
    );
  }

  return (
    <>
      <ScreenHeader
        title={props.title}
        subtitle={props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={native.optionsVersion}
        trailing={
          props.fileInspectorSupported && props.hasThreadCwd ? (
            <ScreenHeaderButton
              accessibilityLabel={
                props.inspectorMode !== null && panes.auxiliaryPaneVisible
                  ? "Hide inspector"
                  : "Show inspector"
              }
              icon="sidebar.right"
              selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
              onPress={props.onToggleInspector}
            />
          ) : null
        }
        onBack={
          layout.usesSplitView
            ? undefined
            : () => {
                // A deep link or cold start has no previous route; Home is the way out.
                // Read the history at press time: it changes without re-rendering this screen.
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.dispatch(StackActions.replace("Home"));
              }
        }
        actions={androidHeaderActions}
        hideBottomBorder
      />
      {native.fallback}
    </>
  );
}

import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { BotId, EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { Keyboard, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { MaterialScreenContent } from "../../components/MaterialScreenContent";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { SettingsSection } from "../settings/components/SettingsSection";
import { BotControls } from "./BotControls";
import { BotEditor } from "./BotEditor";
import { BotMenuRow } from "./BotFormRows";
import { HomeBotsSection } from "./HomeBotsSection";

type BotsRouteParams = {
  readonly environmentId?: string;
  readonly botId?: string;
  readonly create?: boolean;
};

export function BotsRouteScreen({ route }: StaticScreenProps<BotsRouteParams | undefined>) {
  const environmentId = route.params?.environmentId
    ? EnvironmentId.make(route.params.environmentId)
    : null;
  const botId = route.params?.botId ? BotId.make(route.params.botId) : null;
  if (route.params?.create) return <NewBotScreen initialEnvironmentId={environmentId} />;
  if (environmentId && botId)
    return (
      <BotDetailScreen
        key={`${environmentId}:${botId}`}
        environmentId={environmentId}
        botId={botId}
      />
    );
  return (
    <BotScreen title="Bots">
      <HomeBotsSection environmentId={null} searchQuery="" />
    </BotScreen>
  );
}

function useLeaveBots() {
  const navigation = useNavigation();
  return () => {
    Keyboard.dismiss();
    // A deep link has no previous route; Home is the way out.
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  };
}

function BotScreen({ title, children }: { title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const leave = useLeaveBots();
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScreenHeader title={title} sidebar={false} hideBottomBorder onBack={leave} />
      <MaterialScreenContent>
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
        >
          {children}
        </ScreenScrollView>
      </MaterialScreenContent>
    </View>
  );
}

function BotDetailScreen({ environmentId, botId }: { environmentId: EnvironmentId; botId: BotId }) {
  const query = useEnvironmentQuery(
    serverEnvironment.bots.detail({ environmentId, input: { botId } }),
  );
  const [editing, setEditing] = useState(false);
  const detail = query.data;
  return (
    <BotScreen title={editing ? "Profile & memory" : (detail?.bot.name ?? "Bot")}>
      <View className="p-4">
        {!detail ? (
          <Text className="text-foreground-muted">{query.error ?? "Loading bot…"}</Text>
        ) : editing ? (
          <BotEditor
            environmentId={environmentId}
            bot={detail.bot}
            onCancel={() => setEditing(false)}
            onDone={() => {
              setEditing(false);
              query.refresh();
            }}
          />
        ) : (
          <BotControls
            environmentId={environmentId}
            bot={detail.bot}
            tasks={detail.tasks}
            loadError={query.error}
            onChanged={query.refresh}
            onEdit={() => setEditing(true)}
          />
        )}
      </View>
    </BotScreen>
  );
}

function NewBotScreen({ initialEnvironmentId }: { initialEnvironmentId: EnvironmentId | null }) {
  const navigation = useNavigation();
  const leave = useLeaveBots();
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const supportsBots = (id: EnvironmentId) =>
    serverConfigs.get(id)?.environment.capabilities.bots === true;
  const [selected, setSelected] = useState(initialEnvironmentId);
  const environmentId =
    selected ??
    environments.find((environment) => supportsBots(environment.environmentId))?.environmentId ??
    environments[0]?.environmentId ??
    null;
  const environment = environments.find((item) => item.environmentId === environmentId);
  const config = environmentId ? serverConfigs.get(environmentId) : undefined;
  return (
    <BotScreen title="New bot">
      <View className="gap-6 p-4">
        <SettingsSection>
          <BotMenuRow
            icon="desktopcomputer"
            label="Runs on"
            value={environment?.label ?? "Choose environment"}
            actions={environments.map((item) => ({
              id: item.environmentId,
              title: item.label,
              state: item.environmentId === environmentId ? "on" : "off",
            }))}
            onSelect={(id) =>
              setSelected(
                environments.find((item) => item.environmentId === id)?.environmentId ?? null,
              )
            }
          />
        </SettingsSection>
        {!environmentId ? (
          <Text className="px-1 text-foreground-muted">
            Connect an environment to create a bot.
          </Text>
        ) : !config ? (
          <Text className="px-1 text-foreground-muted">Connecting to environment…</Text>
        ) : !supportsBots(environmentId) ? (
          <Text className="px-1 text-foreground-muted">
            Update this environment's T3 server to use bots.
          </Text>
        ) : (
          <BotEditor
            key={environmentId}
            environmentId={environmentId}
            bot={null}
            onCancel={leave}
            onDone={(bot) =>
              navigation.dispatch(
                StackActions.replace("Thread", { environmentId, threadId: bot.threadId }),
              )
            }
          />
        )}
      </View>
    </BotScreen>
  );
}

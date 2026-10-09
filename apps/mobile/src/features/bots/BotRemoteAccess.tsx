import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AuthAccessWriteScope, type BotId, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";
import { ControlPill } from "../../components/ControlPill";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsControlRow } from "../settings/components/SettingsControlRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { BotMenuRow, BotSection } from "./BotFormRows";
import { useBotOperation } from "./useBotOperation";

/** Grants a bot background access to environments saved in Connections. Applies immediately. */
export function BotRemoteAccess({
  environmentId,
  botId,
}: {
  environmentId: EnvironmentId;
  botId: BotId;
}) {
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const remotes = environments.filter((environment) => environment.environmentId !== environmentId);
  const [remoteId, setRemoteId] = useState<EnvironmentId | null>(null);
  const remote =
    remotes.find((environment) => environment.environmentId === remoteId) ?? remotes[0] ?? null;
  const connected = remote?.connection.phase === "connected";
  const connections = useEnvironmentQuery(
    serverEnvironment.bots.connections({ environmentId, input: { botId } }),
  );
  const connect = useAtomCommand(serverEnvironment.bots.connect);
  const disconnect = useAtomCommand(serverEnvironment.bots.disconnect);
  const canUpdate = useAtomValue(serverEnvironment.bots.update.permissionAtom(environmentId));
  const canConnect = useAtomValue(serverEnvironment.bots.connect.permissionAtom(environmentId));
  const canDisconnect = useAtomValue(
    serverEnvironment.bots.disconnect.permissionAtom(environmentId),
  );
  const canGrantAccess = useEnvironmentScope(remote?.environmentId ?? null, AuthAccessWriteScope);
  const { busy, error, run } = useBotOperation();
  const runAndRefresh = (operation: Parameters<typeof run>[0]) =>
    void run(operation).then(() => connections.refresh());

  return (
    <View className="gap-2">
      <BotSection
        title="Remote environment access"
        footer={
          !remote
            ? "Add an environment in Connections first."
            : !connected
              ? "Connect to this environment in Connections first."
              : !canGrantAccess
                ? "This connection needs permission to manage access on that environment."
                : "Grant access, then select its projects above."
        }
      >
        {connections.data?.map((connection) => (
          <SettingsControlRow
            key={connection.environmentId}
            icon="link"
            label={connection.label || connection.baseUrl}
          >
            <ControlPill
              variant="pill"
              label="Disconnect"
              disabled={!canUpdate || !canDisconnect || busy}
              onPress={() =>
                runAndRefresh(() =>
                  disconnect({
                    environmentId,
                    input: { botId, environmentId: connection.environmentId },
                  }),
                )
              }
            />
          </SettingsControlRow>
        ))}
        {remote ? (
          <>
            <BotMenuRow
              icon="desktopcomputer"
              label="Environment"
              value={remote.label}
              actions={remotes.map((environment) => ({
                id: environment.environmentId,
                title: environment.label,
                state: environment.environmentId === remote.environmentId ? "on" : "off",
              }))}
              onSelect={(id) =>
                setRemoteId(
                  remotes.find((environment) => environment.environmentId === id)?.environmentId ??
                    null,
                )
              }
            />
            <SettingsActionRow
              icon="plus"
              label="Grant access"
              loading={busy}
              disabled={!canUpdate || !canConnect || !canGrantAccess || !connected || busy}
              onPress={() =>
                runAndRefresh(() =>
                  connect({
                    environmentId,
                    input: { botId, remoteEnvironmentId: remote.environmentId },
                  }),
                )
              }
            />
          </>
        ) : null}
        <SettingsRow
          icon="server.rack"
          label="Connections"
          onPress={() => navigation.navigate("Connections")}
        />
      </BotSection>
      {error ? <ErrorBanner message={error} /> : null}
    </View>
  );
}

import type { MenuAction } from "@react-native-menu/menu";
import type { ModelSelection } from "@t3tools/contracts";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import type { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import type { ModelOption } from "../../lib/modelOptions";
import { ConnectionFormField } from "../connection/ConnectionFormField";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";

/** A grouped section with an optional note below it. `padded` suits text fields. */
export function BotSection(props: {
  readonly title?: string;
  readonly footer?: string;
  readonly padded?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <SettingsSection title={props.title}>
        {props.padded ? <View className="gap-4 p-4">{props.children}</View> : props.children}
      </SettingsSection>
      {props.footer ? (
        <Text className="px-1 text-xs text-foreground-muted">{props.footer}</Text>
      ) : null}
    </View>
  );
}

export function BotTextField(props: ComponentProps<typeof ConnectionFormField>) {
  return (
    <ConnectionFormField
      {...props}
      textAlignVertical={props.multiline ? "top" : "center"}
      style={props.multiline ? { minHeight: 112 } : undefined}
    />
  );
}

/** A settings row that opens a native menu of choices. */
export function BotMenuRow(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly value: string;
  readonly actions: MenuAction[];
  readonly onSelect: (id: string) => void;
  readonly disabled?: boolean;
}) {
  const row = (
    <SettingsRow
      icon={props.icon}
      label={props.label}
      value={props.value}
      valuePosition="trailing"
      disabled={props.disabled || props.actions.length === 0}
    />
  );
  if (props.disabled || props.actions.length === 0) return row;
  return (
    <ControlPillMenu
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
    >
      {row}
    </ControlPillMenu>
  );
}

export function BotModelRow(props: {
  readonly models: ReadonlyArray<ModelOption>;
  readonly selection: ModelSelection | null;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const current = props.models.find(
    (option) =>
      option.selection.instanceId === props.selection?.instanceId &&
      option.selection.model === props.selection?.model,
  );
  return (
    <BotMenuRow
      icon="cube"
      label="Model"
      value={
        current?.label ??
        props.selection?.model ??
        (props.models.length ? "Choose model" : "No models available")
      }
      actions={props.models.map((option) => ({
        id: option.key,
        title: option.label,
        subtitle: option.providerLabel,
        state: option === current ? "on" : "off",
        attributes: { disabled: option.isUnavailable === true },
      }))}
      onSelect={(key) => {
        const choice = props.models.find((option) => option.key === key);
        if (choice) props.onChange(choice.selection);
      }}
    />
  );
}

import type { ComponentProps } from "react";
import { ActivityIndicator, Platform, Pressable } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";
import { MaterialListRow } from "../../../components/MaterialListRow";
import { cn } from "../../../lib/cn";

export function SettingsActionRow(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly tone?: "default" | "danger";
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onPress: () => void;
}) {
  const danger = props.tone === "danger";
  const textClassName = danger ? "tabular-nums text-danger-foreground" : "text-foreground";
  const iconColorClassName = danger ? "accent-danger-foreground" : "accent-icon-muted";
  const icon = (
    <SymbolView
      name={props.icon}
      size={20}
      tintColorClassName={iconColorClassName}
      type="monochrome"
      weight="regular"
    />
  );
  const spinner = props.loading ? <ActivityIndicator colorClassName={iconColorClassName} /> : null;

  if (Platform.OS === "android") {
    return (
      <MaterialListRow
        className="bg-grouped-card"
        title={props.label}
        titleClassName={textClassName}
        leading={icon}
        trailing={spinner}
        disabled={props.disabled}
        onPress={props.onPress}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className="min-h-13 flex-row items-center gap-3 px-3.5 py-3 disabled:opacity-40"
    >
      {icon}
      <Text className={cn("flex-1 text-base", textClassName)}>{props.label}</Text>
      {spinner}
    </Pressable>
  );
}

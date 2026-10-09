import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";

export function SettingsSection(props: {
  readonly title?: string;
  readonly titleIcon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2">
      {props.title ? (
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1 flex-row items-center gap-2 px-1">
            {props.titleIcon}
            <Text className="shrink text-xs font-t3-medium text-foreground-muted">
              {props.title}
            </Text>
          </View>
          {props.trailing}
        </View>
      ) : null}
      <View className="overflow-hidden rounded-xl border border-border bg-grouped-card">
        {props.children}
      </View>
    </View>
  );
}

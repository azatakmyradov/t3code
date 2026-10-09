import { View } from "react-native";

import { AppText as Text } from "./AppText";
import { cn } from "../lib/cn";

export interface StatusTone {
  readonly label: string;
  readonly pillClassName: string;
  readonly textClassName: string;
}

export function StatusPill(
  props: StatusTone & {
    readonly size?: "default" | "compact";
  },
) {
  const size = props.size ?? "default";
  return (
    <View
      className={cn(
        "rounded-md",
        size === "compact" ? "px-2 py-0.5" : "px-2.5 py-1",
        props.pillClassName,
      )}
    >
      <Text
        className={cn(
          "font-t3-medium",
          size === "compact" ? "text-2xs" : "text-xs",
          props.textClassName,
        )}
      >
        {props.label}
      </Text>
    </View>
  );
}

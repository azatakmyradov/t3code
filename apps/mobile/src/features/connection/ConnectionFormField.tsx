import { View } from "react-native";

import { AppText, AppTextInput, type AppTextInputProps } from "../../components/AppText";
import { cn } from "../../lib/cn";

type ConnectionFormFieldProps = Omit<AppTextInputProps, "accessibilityLabel" | "className"> & {
  readonly label: string;
  readonly className?: string;
};

/** Labeled connection input with a native wrapper retained inside form sheets. */
export function ConnectionFormField({ label, className, ...inputProps }: ConnectionFormFieldProps) {
  return (
    <View collapsable={false} className={cn("gap-1.5", className)}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="text-xs font-t3-medium text-foreground-muted"
      >
        {label}
      </AppText>
      <AppTextInput {...inputProps} accessibilityLabel={label} className="rounded-lg px-3 py-2.5" />
    </View>
  );
}

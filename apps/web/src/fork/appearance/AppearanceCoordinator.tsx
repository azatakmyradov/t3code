import { useEffect } from "react";

import { syncBrowserChromeTheme, useTheme } from "../../hooks/useTheme";
import { applyAppearanceCssVariables } from "./appearanceCss";
import { useAppearanceSettings } from "./appearanceSettingsStore";

export function AppearanceCoordinator() {
  const { appearance } = useAppearanceSettings();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    applyAppearanceCssVariables(document.documentElement, appearance, resolvedTheme);
    syncBrowserChromeTheme();
  }, [appearance, resolvedTheme]);

  return null;
}

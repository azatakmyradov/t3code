import { describe, expect, it } from "vite-plus/test";

import { deriveAppearanceCssVariables, selectAppearanceThemeColors } from "./appearanceCss";
import { DEFAULT_WEB_APPEARANCE_SETTINGS, type AppearanceSettings } from "./appearanceDefaults";

function appearanceWithContrast(contrast: number): AppearanceSettings {
  return {
    ...DEFAULT_WEB_APPEARANCE_SETTINGS,
    light: {
      ...DEFAULT_WEB_APPEARANCE_SETTINGS.light,
      contrast,
    },
  };
}

describe("appearanceCss", () => {
  it("selects light config for light theme", () => {
    expect(selectAppearanceThemeColors(DEFAULT_WEB_APPEARANCE_SETTINGS, "light")).toBe(
      DEFAULT_WEB_APPEARANCE_SETTINGS.light,
    );
  });

  it("selects dark config for dark theme", () => {
    expect(selectAppearanceThemeColors(DEFAULT_WEB_APPEARANCE_SETTINGS, "dark")).toBe(
      DEFAULT_WEB_APPEARANCE_SETTINGS.dark,
    );
  });

  it("derives CSS variables from accent, background, foreground, and contrast", () => {
    const appearance: AppearanceSettings = {
      ...DEFAULT_WEB_APPEARANCE_SETTINGS,
      light: {
        accentColor: "#ABCDEF",
        backgroundColor: "#FAFAFA",
        foregroundColor: "#101010",
        contrast: 50,
      },
      uiFontFamily: "Inter, sans-serif",
      codeFontFamily: "JetBrains Mono, monospace",
      uiFontSize: 15,
      codeFontSize: 13,
    };

    expect(deriveAppearanceCssVariables(appearance, "light")).toMatchObject({
      "--background": "#FAFAFA",
      "--foreground": "#101010",
      "--primary": "#ABCDEF",
      "--ring": "#ABCDEF",
      "--font-sans": "Inter, sans-serif",
      "--font-mono": "JetBrains Mono, monospace",
      "--appearance-ui-font-size": "15px",
      "--appearance-code-font-size": "13px",
      "--appearance-ui-font-scale": String(15 / 14),
      "--appearance-code-font-scale": String(13 / 12),
      "--card": "color-mix(in srgb, #FAFAFA 96%, #101010)",
      "--muted": "color-mix(in srgb, #101010 10%, transparent)",
      "--border": "color-mix(in srgb, #101010 13%, transparent)",
      "--input": "color-mix(in srgb, #101010 16%, transparent)",
      "--secondary": "color-mix(in srgb, #101010 10%, transparent)",
    });
  });

  it("clamps contrast-derived values", () => {
    expect(deriveAppearanceCssVariables(appearanceWithContrast(-100), "light")).toMatchObject({
      "--card": "color-mix(in srgb, #FFFFFF 100%, #0D0D0D)",
      "--muted": "color-mix(in srgb, #0D0D0D 3%, transparent)",
      "--border": "color-mix(in srgb, #0D0D0D 5%, transparent)",
      "--input": "color-mix(in srgb, #0D0D0D 7%, transparent)",
    });

    expect(deriveAppearanceCssVariables(appearanceWithContrast(250), "light")).toMatchObject({
      "--card": "color-mix(in srgb, #FFFFFF 92%, #0D0D0D)",
      "--muted": "color-mix(in srgb, #0D0D0D 16%, transparent)",
      "--border": "color-mix(in srgb, #0D0D0D 20%, transparent)",
      "--input": "color-mix(in srgb, #0D0D0D 24%, transparent)",
    });
  });
});

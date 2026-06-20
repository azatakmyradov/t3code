import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_WEB_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  normalizeHexColorInput,
} from "./appearanceDefaults";

describe("appearanceDefaults", () => {
  it("normalizes hex colors", () => {
    expect(normalizeHexColorInput("#abc")).toBe("#AABBCC");
    expect(normalizeHexColorInput("#0169cc")).toBe("#0169CC");
    expect(normalizeHexColorInput("#12")).toBe(null);
  });

  it("normalizes persisted appearance settings with defaults and bounds", () => {
    expect(
      normalizeAppearanceSettings({
        light: {
          accentColor: "#abc",
          backgroundColor: "invalid",
          foregroundColor: "#101010",
          contrast: 250,
        },
        uiFontFamily: "  Inter, sans-serif  ",
        codeFontFamily: "",
        translucentSidebar: true,
        uiFontSize: 9,
        codeFontSize: 20,
        fontSmoothing: false,
      }),
    ).toEqual({
      ...DEFAULT_WEB_APPEARANCE_SETTINGS,
      light: {
        ...DEFAULT_WEB_APPEARANCE_SETTINGS.light,
        accentColor: "#AABBCC",
        foregroundColor: "#101010",
        contrast: 100,
      },
      uiFontFamily: "Inter, sans-serif",
      translucentSidebar: true,
      uiFontSize: 10,
      codeFontSize: 20,
      fontSmoothing: false,
    });
  });
});

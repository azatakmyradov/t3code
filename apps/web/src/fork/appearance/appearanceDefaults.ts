export type AppearanceHexColor = `#${string}`;

export type AppearanceThemeColors = {
  readonly accentColor: AppearanceHexColor;
  readonly backgroundColor: AppearanceHexColor;
  readonly foregroundColor: AppearanceHexColor;
  readonly contrast: number;
};

export type AppearanceSettings = {
  readonly light: AppearanceThemeColors;
  readonly dark: AppearanceThemeColors;
  readonly uiFontFamily: string;
  readonly codeFontFamily: string;
  readonly translucentSidebar: boolean;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly fontSmoothing: boolean;
};

export const DEFAULT_APPEARANCE_UI_FONT_FAMILY =
  '"DM Sans Variable", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const DEFAULT_APPEARANCE_CODE_FONT_FAMILY =
  '"SF Mono", "SFMono-Regular", "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace';

export const DEFAULT_APPEARANCE_LIGHT_COLORS = {
  accentColor: "#1A1A1A",
  backgroundColor: "#FFFFFF",
  foregroundColor: "#0D0D0D",
  contrast: 45,
} as const satisfies AppearanceThemeColors;

export const DEFAULT_APPEARANCE_DARK_COLORS = {
  accentColor: "#2E2E2E",
  backgroundColor: "#111111",
  foregroundColor: "#FCFCFC",
  contrast: 60,
} as const satisfies AppearanceThemeColors;

export const DEFAULT_WEB_APPEARANCE_SETTINGS = {
  light: DEFAULT_APPEARANCE_LIGHT_COLORS,
  dark: DEFAULT_APPEARANCE_DARK_COLORS,
  uiFontFamily: DEFAULT_APPEARANCE_UI_FONT_FAMILY,
  codeFontFamily: DEFAULT_APPEARANCE_CODE_FONT_FAMILY,
  translucentSidebar: false,
  uiFontSize: 14,
  codeFontSize: 12,
  fontSmoothing: true,
} as const satisfies AppearanceSettings;

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const MIN_CONTRAST = 0;
const MAX_CONTRAST = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeHexColorInput(value: string): AppearanceHexColor | null {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }

  const hex = trimmed.slice(1).toUpperCase();
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : hex;

  return `#${expanded}`;
}

function normalizeHexColorValue(value: unknown, fallback: AppearanceHexColor): AppearanceHexColor {
  return typeof value === "string" ? (normalizeHexColorInput(value) ?? fallback) : fallback;
}

export function normalizeFontFamilyInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFontFamilyValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? (normalizeFontFamilyInput(value) ?? fallback) : fallback;
}

function normalizeThemeColors(
  value: unknown,
  defaults: AppearanceThemeColors,
): AppearanceThemeColors {
  const record = isRecord(value) ? value : {};

  return {
    accentColor: normalizeHexColorValue(record.accentColor, defaults.accentColor),
    backgroundColor: normalizeHexColorValue(record.backgroundColor, defaults.backgroundColor),
    foregroundColor: normalizeHexColorValue(record.foregroundColor, defaults.foregroundColor),
    contrast: normalizeInteger(record.contrast, defaults.contrast, MIN_CONTRAST, MAX_CONTRAST),
  };
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const record = isRecord(value) ? value : {};

  return {
    light: normalizeThemeColors(record.light, DEFAULT_WEB_APPEARANCE_SETTINGS.light),
    dark: normalizeThemeColors(record.dark, DEFAULT_WEB_APPEARANCE_SETTINGS.dark),
    uiFontFamily: normalizeFontFamilyValue(
      record.uiFontFamily,
      DEFAULT_WEB_APPEARANCE_SETTINGS.uiFontFamily,
    ),
    codeFontFamily: normalizeFontFamilyValue(
      record.codeFontFamily,
      DEFAULT_WEB_APPEARANCE_SETTINGS.codeFontFamily,
    ),
    translucentSidebar: normalizeBoolean(
      record.translucentSidebar,
      DEFAULT_WEB_APPEARANCE_SETTINGS.translucentSidebar,
    ),
    uiFontSize: normalizeInteger(
      record.uiFontSize,
      DEFAULT_WEB_APPEARANCE_SETTINGS.uiFontSize,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
    ),
    codeFontSize: normalizeInteger(
      record.codeFontSize,
      DEFAULT_WEB_APPEARANCE_SETTINGS.codeFontSize,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
    ),
    fontSmoothing: normalizeBoolean(
      record.fontSmoothing,
      DEFAULT_WEB_APPEARANCE_SETTINGS.fontSmoothing,
    ),
  };
}

export function isAppearanceDefault(appearance: AppearanceSettings): boolean {
  return JSON.stringify(appearance) === JSON.stringify(DEFAULT_WEB_APPEARANCE_SETTINGS);
}

import type { AppearanceSettings, AppearanceThemeColors } from "./appearanceDefaults";

export type ResolvedAppearanceTheme = "light" | "dark";

export type AppearanceCssVariables = Record<`--${string}`, string>;

const APPEARANCE_STYLE_ID = "fork-appearance-style";

const DERIVED_COLOR_LIMITS = {
  surfaceTint: { min: 0, max: 8 },
  muted: { min: 3, max: 16 },
  accent: { min: 4, max: 18 },
  border: { min: 5, max: 20 },
  input: { min: 7, max: 24 },
} as const;

const DEFAULT_UI_FONT_SIZE = 14;
const DEFAULT_CODE_FONT_SIZE = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampContrast(contrast: number): number {
  return clamp(Number.isFinite(contrast) ? Math.round(contrast) : 0, 0, 100);
}

function percentageFromContrast(
  contrast: number,
  limits: { readonly min: number; readonly max: number },
): number {
  const raw = limits.min + ((limits.max - limits.min) * clampContrast(contrast)) / 100;
  return clamp(Math.round(raw), limits.min, limits.max);
}

function colorMixWithForeground(colors: AppearanceThemeColors, foregroundPercent: number): string {
  return `color-mix(in srgb, ${colors.foregroundColor} ${foregroundPercent}%, transparent)`;
}

function surfaceMix(colors: AppearanceThemeColors, foregroundPercent: number): string {
  return `color-mix(in srgb, ${colors.backgroundColor} ${100 - foregroundPercent}%, ${colors.foregroundColor})`;
}

function ensureAppearanceStyle(root: HTMLElement): void {
  const document = root.ownerDocument;
  if (document.getElementById(APPEARANCE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = APPEARANCE_STYLE_ID;
  style.textContent = `
body {
  font-family: var(--font-sans);
  font-size: var(--appearance-ui-font-size);
}

:root[data-appearance-font-scale="true"] :where(.text-xs) {
  font-size: calc(12px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.text-sm) {
  font-size: calc(14px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.text-base) {
  font-size: calc(16px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.text-lg) {
  font-size: calc(18px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.text-xl) {
  font-size: calc(20px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[8px]"]) {
  font-size: calc(8px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[9px]"]) {
  font-size: calc(9px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[10px]"]) {
  font-size: calc(10px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[11px]"]) {
  font-size: calc(11px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[13px]"]) {
  font-size: calc(13px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[14px]"], [class~="sm:text-[14px]"]) {
  font-size: calc(14px * var(--appearance-ui-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where([class~="text-[16px]"]) {
  font-size: calc(16px * var(--appearance-ui-font-scale)) !important;
}

@media (min-width: 40rem) {
  :root[data-appearance-font-scale="true"] :where([class~="sm:text-xs"]) {
    font-size: calc(12px * var(--appearance-ui-font-scale)) !important;
  }

  :root[data-appearance-font-scale="true"] :where([class~="sm:text-sm"]) {
    font-size: calc(14px * var(--appearance-ui-font-scale)) !important;
  }

  :root[data-appearance-font-scale="true"] :where([class~="sm:text-base"]) {
    font-size: calc(16px * var(--appearance-ui-font-scale)) !important;
  }

  :root[data-appearance-font-scale="true"] :where([class~="sm:text-[14px]"]) {
    font-size: calc(14px * var(--appearance-ui-font-scale)) !important;
  }
}

:root[data-appearance-font-smoothing="true"] body {
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

:root[data-appearance-font-smoothing="false"] body {
  -webkit-font-smoothing: auto;
  text-rendering: auto;
}

pre,
code {
  font-family: var(--font-mono);
  font-size: var(--appearance-code-font-size);
}

:root[data-appearance-font-scale="true"] :where(.font-mono, pre, code) {
  font-family: var(--font-mono);
}

:root[data-appearance-font-scale="true"] :where(.font-mono.text-xs, pre.text-xs, code.text-xs) {
  font-size: calc(12px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.font-mono.text-sm, pre.text-sm, code.text-sm) {
  font-size: calc(14px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.font-mono.text-base, pre.text-base, code.text-base) {
  font-size: calc(16px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.font-mono[class~="text-[10px]"], pre[class~="text-[10px]"], code[class~="text-[10px]"]) {
  font-size: calc(10px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.font-mono[class~="text-[11px]"], pre[class~="text-[11px]"], code[class~="text-[11px]"]) {
  font-size: calc(11px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.font-mono[class~="text-[12px]"], pre[class~="text-[12px]"], code[class~="text-[12px]"]) {
  font-size: calc(12px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-font-scale="true"] :where(.font-mono[class~="text-[13px]"], pre[class~="text-[13px]"], code[class~="text-[13px]"]) {
  font-size: calc(13px * var(--appearance-code-font-scale)) !important;
}

:root[data-appearance-translucent-sidebar="true"] [data-slot="sidebar-inner"] {
  background: color-mix(in srgb, var(--background) 84%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  backdrop-filter: blur(18px) saturate(1.2);
}
`;
  document.head.append(style);
}

export function selectAppearanceThemeColors(
  appearance: AppearanceSettings,
  resolvedTheme: ResolvedAppearanceTheme,
): AppearanceThemeColors {
  return resolvedTheme === "dark" ? appearance.dark : appearance.light;
}

export function deriveAppearanceCssVariables(
  appearance: AppearanceSettings,
  resolvedTheme: ResolvedAppearanceTheme,
): AppearanceCssVariables {
  const colors = selectAppearanceThemeColors(appearance, resolvedTheme);
  const surfaceTint = percentageFromContrast(colors.contrast, DERIVED_COLOR_LIMITS.surfaceTint);
  const mutedOpacity = percentageFromContrast(colors.contrast, DERIVED_COLOR_LIMITS.muted);
  const accentOpacity = percentageFromContrast(colors.contrast, DERIVED_COLOR_LIMITS.accent);
  const borderOpacity = percentageFromContrast(colors.contrast, DERIVED_COLOR_LIMITS.border);
  const inputOpacity = percentageFromContrast(colors.contrast, DERIVED_COLOR_LIMITS.input);

  return {
    "--background": colors.backgroundColor,
    "--foreground": colors.foregroundColor,
    "--primary": colors.accentColor,
    "--ring": colors.accentColor,
    "--font-sans": appearance.uiFontFamily,
    "--font-mono": appearance.codeFontFamily,
    "--appearance-ui-font-size": `${appearance.uiFontSize}px`,
    "--appearance-code-font-size": `${appearance.codeFontSize}px`,
    "--appearance-ui-font-scale": String(appearance.uiFontSize / DEFAULT_UI_FONT_SIZE),
    "--appearance-code-font-scale": String(appearance.codeFontSize / DEFAULT_CODE_FONT_SIZE),
    "--card": surfaceMix(colors, surfaceTint),
    "--card-foreground": colors.foregroundColor,
    "--popover": surfaceMix(colors, surfaceTint),
    "--popover-foreground": colors.foregroundColor,
    "--muted": colorMixWithForeground(colors, mutedOpacity),
    "--muted-foreground": `color-mix(in srgb, ${colors.foregroundColor} 72%, ${colors.backgroundColor})`,
    "--accent": colorMixWithForeground(colors, accentOpacity),
    "--accent-foreground": colors.foregroundColor,
    "--border": colorMixWithForeground(colors, borderOpacity),
    "--input": colorMixWithForeground(colors, inputOpacity),
    "--secondary": colorMixWithForeground(colors, mutedOpacity),
    "--secondary-foreground": colors.foregroundColor,
  };
}

export function applyAppearanceCssVariables(
  root: HTMLElement,
  appearance: AppearanceSettings,
  resolvedTheme: ResolvedAppearanceTheme,
): void {
  ensureAppearanceStyle(root);

  root.dataset.appearanceFontSmoothing = String(appearance.fontSmoothing);
  root.dataset.appearanceFontScale = "true";
  root.dataset.appearanceTranslucentSidebar = String(appearance.translucentSidebar);

  for (const [property, value] of Object.entries(
    deriveAppearanceCssVariables(appearance, resolvedTheme),
  )) {
    root.style.setProperty(property, value);
  }
}

import { Platform } from "react-native";

// System families carry no weight, so callers also set `fontWeight`. Android's
// medium family keeps 500 distinct below API 28. Mirrors `--font-*` in global.css.
const FONT_FAMILIES = Platform.select({
  android: { regular: "sans-serif", medium: "sans-serif-medium", bold: "sans-serif" },
  default: { regular: "System", medium: "System", bold: "System" },
});

/**
 * Resolves a font family for APIs that require a style object or native prop.
 * Prefer Uniwind font classes when the target component accepts `className`.
 */
export function useFontFamily(weight: keyof typeof FONT_FAMILIES): string {
  return FONT_FAMILIES[weight];
}

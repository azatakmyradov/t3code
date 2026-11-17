import { createTextmateFallback, textmateTheme } from "@pierre/diffs/highlighter/textmate-fallback";
import pierreDark from "@pierre/highlights/themes/pierre-dark";
import pierreLight from "@pierre/highlights/themes/pierre-light";
import grammar from "@t3tools/client-runtime/sage-x3-grammar";

let highlighter: ReturnType<typeof createTextmateFallback> | undefined;

export function tokenizeSageX3(code: string) {
  if (!highlighter) {
    highlighter = createTextmateFallback([grammar]);
    for (const theme of [pierreLight, pierreDark]) {
      highlighter.loadThemeSync(
        textmateTheme({
          name: theme.name,
          type: theme.appearance === "light" ? "light" : "dark",
          fg: theme.style.text ?? "#888888",
          bg: theme.style.background ?? "#ffffff",
          colors: {
            "editor.foreground": theme.style.text ?? "#888888",
            "editor.background": theme.style.background ?? "#ffffff",
          },
          zed: theme,
        }),
      );
    }
  }
  const tokens = highlighter.codeToTokensWithThemes(code, {
    lang: "sage-x3",
    themes: { light: pierreLight.name, dark: pierreDark.name },
    tokenizeMaxLineLength: 1_000,
  });
  return {
    byteLength: code.length * 2 + tokens.reduce((total, line) => total + line.length, 0) * 96,
    lineCount: tokens.length,
    highlightLine(index: number, scheme: "light" | "dark") {
      return tokens[index]?.map((token) => ({
        content: token.content,
        color: token.variants[scheme]?.color ?? null,
        fontStyle: token.variants[scheme]?.fontStyle ?? null,
      }));
    },
  };
}

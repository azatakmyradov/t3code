import { getFiletypeFromFileName } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";
import { DIFF_THEME_NAMES } from "./diffRendering";

describe("dialect file types", () => {
  it.each([
    ["src/init.luau", "lua"],
    ["styles/page.xsl", "xml"],
    ["styles/page.xslt", "xml"],
    ...["src", "SRC", "4gl", "4GL", "adx", "ADX", "x3", "X3"].map((ext) => [
      `TRT/ZDEMO.${ext}`,
      "sage-x3",
    ]),
  ])("%s highlights as %s", (path, language) => {
    expect(getFiletypeFromFileName(path)).toBe(language);
  });
});

it.each([
  "asm",
  "assembly",
  "s",
  ...["asm", "ASM", "s", "S", "nasm", "NASM"].map((ext) => `src/start.${ext}`),
])("highlights assembly in %s", async (hint) => {
  const language = hint.includes("/") ? getFiletypeFromFileName(hint) : hint;
  const highlighter = await getSyntaxHighlighterPromise(language);
  const code = "mov eax, 42 ; answer\nret";
  for (const theme of Object.values(DIFF_THEME_NAMES)) {
    const { tokens } = highlighter.codeToTokens(code, { lang: language, theme });
    expect(tokens.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(code);
    expect(new Set(tokens.flat().map((token) => token.color)).size).toBeGreaterThan(1);
  }
});

it.each(["sage-x3", "x3", "4gl", "sage-x3-4gl", "adonix"])(
  "highlights Sage X3 in %s",
  async (language) => {
    const highlighter = await getSyntaxHighlighterPromise(language);
    const code =
      '$ACTION\nLocal Char MESSAGE(80)\nIf fstat = 0\n  MESSAGE = "Hello" # comment\nEndif';
    for (const theme of Object.values(DIFF_THEME_NAMES)) {
      const { tokens } = highlighter.codeToTokens(code, { lang: language, theme });
      expect(tokens.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(
        code,
      );
      expect(new Set(tokens.flat().map((token) => token.color)).size).toBeGreaterThan(3);
    }
  },
);

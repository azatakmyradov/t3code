import type { ChatSnippet } from "@t3tools/contracts";
import { normalizeChatSnippetKeyword } from "@t3tools/contracts";

const SNIPPET_KEYWORD_PATTERN = /^[a-z0-9_-]+$/;

export type SnippetValidationResult =
  | { readonly ok: true; readonly snippet: ChatSnippet }
  | { readonly ok: false; readonly message: string };

export function normalizeSnippetKeyword(value: string): string {
  return normalizeChatSnippetKeyword(value);
}

export function validateSnippetDraft(input: {
  readonly keyword: string;
  readonly value: string;
}): SnippetValidationResult {
  const keyword = normalizeSnippetKeyword(input.keyword);
  const value = input.value.trim();
  if (!keyword) {
    return { ok: false, message: "Keyword is required." };
  }
  if (!SNIPPET_KEYWORD_PATTERN.test(keyword)) {
    return { ok: false, message: "Use letters, numbers, dashes, and underscores." };
  }
  if (!value) {
    return { ok: false, message: "Value is required." };
  }
  return { ok: true, snippet: { keyword, value } };
}

export function hasDuplicateSnippetKeyword(snippets: ReadonlyArray<ChatSnippet>): boolean {
  const seen = new Set<string>();
  for (const snippet of snippets) {
    const keyword = normalizeSnippetKeyword(snippet.keyword);
    if (seen.has(keyword)) {
      return true;
    }
    seen.add(keyword);
  }
  return false;
}

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const CHAT_SNIPPET_KEYWORD_PATTERN = /^[a-z0-9_-]+$/;

export const normalizeChatSnippetKeyword = (value: string): string =>
  value.trim().replace(/^:/, "").toLowerCase();

const normalizeValidChatSnippetKeyword = (value: string) => {
  const normalized = normalizeChatSnippetKeyword(value);
  if (normalized.length > 0 && CHAT_SNIPPET_KEYWORD_PATTERN.test(normalized)) {
    return Effect.succeed(normalized);
  }
  return Effect.fail(
    new SchemaIssue.InvalidValue(Option.some(value), {
      message: "Expected a snippet keyword using only letters, numbers, dashes, and underscores.",
    }),
  );
};

export const ChatSnippetKeyword = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformOrFail({
      decode: normalizeValidChatSnippetKeyword,
      encode: normalizeValidChatSnippetKeyword,
    }),
  ),
);
export type ChatSnippetKeyword = typeof ChatSnippetKeyword.Type;

export const ChatSnippet = Schema.Struct({
  keyword: ChatSnippetKeyword,
  value: TrimmedNonEmptyString,
});
export type ChatSnippet = typeof ChatSnippet.Type;

export const ChatSnippets = Schema.Array(ChatSnippet).check(
  Schema.makeFilter(
    (snippets) => {
      const seen = new Set<string>();
      for (const snippet of snippets) {
        if (seen.has(snippet.keyword)) {
          return new SchemaIssue.InvalidValue(Option.some(snippet.keyword), {
            message: "Duplicate chat snippet keyword.",
          });
        }
        seen.add(snippet.keyword);
      }
      return true;
    },
    { identifier: "UniqueChatSnippetKeywords" },
  ),
);
export type ChatSnippets = typeof ChatSnippets.Type;

export const ForkSettings = Schema.Struct({
  snippets: ChatSnippets.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ForkSettings = typeof ForkSettings.Type;

export const ForkSettingsPatch = Schema.Struct({
  snippets: Schema.optionalKey(ChatSnippets),
});
export type ForkSettingsPatch = typeof ForkSettingsPatch.Type;

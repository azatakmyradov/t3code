import type { ServerSettings } from "@t3tools/contracts/settings";
import { TextCursorInputIcon } from "lucide-react";

import type { ComposerTrigger } from "../../composer-logic";
import type { ForkComposerMenuItem, SnippetComposerMenuItem } from "../composerExtensions";
import { formatSnippetDescriptionPreview, searchSnippetItems } from "./snippetSearch";

export function getSnippetComposerMenuItems(input: {
  readonly trigger: ComposerTrigger;
  readonly settings: ServerSettings;
}): SnippetComposerMenuItem[] {
  if (input.trigger.kind !== "fork-snippet") {
    return [];
  }
  const snippetItems = input.settings.fork.snippets.map((snippet, index) => ({
    id: `fork-snippet:${index}:${snippet.keyword}`,
    type: "fork-snippet" as const,
    keyword: snippet.keyword,
    value: snippet.value,
    label: `:${snippet.keyword}`,
    description: formatSnippetDescriptionPreview(snippet.value),
  }));
  return searchSnippetItems(snippetItems, input.trigger.query);
}

export function applySnippetComposerMenuItem(input: {
  readonly item: ForkComposerMenuItem;
  readonly trigger: ComposerTrigger;
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { readonly expectedText?: string },
  ) => boolean;
}): boolean {
  if (input.item.type !== "fork-snippet") {
    return false;
  }
  return input.applyPromptReplacement(
    input.trigger.rangeStart,
    input.trigger.rangeEnd,
    input.item.value,
  );
}

export function renderSnippetComposerMenuIcon() {
  return <TextCursorInputIcon className="size-4 shrink-0 text-muted-foreground/80" />;
}

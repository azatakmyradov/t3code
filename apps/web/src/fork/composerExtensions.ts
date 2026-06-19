import type { ServerSettings } from "@t3tools/contracts/settings";

import type { ComposerTrigger } from "../composer-logic";
import {
  applySnippetComposerMenuItem,
  getSnippetComposerMenuItems,
  renderSnippetComposerMenuIcon,
} from "./snippets/snippetComposer";

export type ForkComposerMenuItem = {
  id: string;
  type: "fork-snippet";
  keyword: string;
  value: string;
  label: string;
  description: string;
};

export type ForkComposerTriggerKind = "fork-snippet";

export function detectForkComposerTrigger(input: {
  readonly text: string;
  readonly cursor: number;
  readonly token: string;
  readonly tokenStart: number;
}): ComposerTrigger | null {
  if (!input.token.startsWith(":")) {
    return null;
  }
  return {
    kind: "fork-snippet",
    query: input.token.slice(1),
    rangeStart: input.tokenStart,
    rangeEnd: input.cursor,
  };
}

export function getForkComposerMenuItems(input: {
  readonly trigger: ComposerTrigger;
  readonly settings: ServerSettings;
}): ForkComposerMenuItem[] {
  return getSnippetComposerMenuItems(input);
}

export function applyForkComposerMenuItem(input: {
  readonly item: ForkComposerMenuItem;
  readonly trigger: ComposerTrigger;
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { readonly expectedText?: string },
  ) => boolean;
}): boolean {
  return applySnippetComposerMenuItem(input);
}

export function renderForkComposerMenuItemIcon(item: ForkComposerMenuItem) {
  if (item.type === "fork-snippet") {
    return renderSnippetComposerMenuIcon();
  }
  return null;
}

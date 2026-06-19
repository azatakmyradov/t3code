import type { ServerSettings } from "@t3tools/contracts/settings";
import type { ReactNode } from "react";

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

export type DetectComposerTriggerInput = {
  readonly text: string;
  readonly cursor: number;
  readonly token: string;
  readonly tokenStart: number;
};

export type GetComposerMenuItemsInput = {
  readonly trigger: ComposerTrigger;
  readonly settings: ServerSettings;
};

export type ApplyComposerMenuItemInput = {
  readonly item: ForkComposerMenuItem;
  readonly trigger: ComposerTrigger;
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { readonly expectedText?: string },
  ) => boolean;
};

export type ForkComposerExtension = {
  readonly triggerKinds: readonly ForkComposerTriggerKind[];
  readonly menuGroup: { readonly id: string; readonly label: string };
  readonly emptyState: string;
  readonly detectTrigger: (input: DetectComposerTriggerInput) => ComposerTrigger | null;
  readonly getMenuItems: (input: GetComposerMenuItemsInput) => readonly ForkComposerMenuItem[];
  readonly applyMenuItem: (input: ApplyComposerMenuItemInput) => boolean;
  readonly renderIcon: (item: ForkComposerMenuItem) => ReactNode;
};

const snippetComposerExtension: ForkComposerExtension = {
  triggerKinds: ["fork-snippet"],
  menuGroup: { id: "snippets", label: "Snippets" },
  emptyState: "No matching snippets.",
  detectTrigger: (input) => {
    if (!input.token.startsWith(":")) {
      return null;
    }
    return {
      kind: "fork-snippet",
      query: input.token.slice(1),
      rangeStart: input.tokenStart,
      rangeEnd: input.cursor,
    };
  },
  getMenuItems: getSnippetComposerMenuItems,
  applyMenuItem: applySnippetComposerMenuItem,
  renderIcon: () => renderSnippetComposerMenuIcon(),
};

export const forkComposerExtensions = [snippetComposerExtension] as const;

export function detectForkComposerTrigger(
  input: DetectComposerTriggerInput,
): ComposerTrigger | null {
  for (const extension of forkComposerExtensions) {
    const trigger = extension.detectTrigger(input);
    if (trigger) return trigger;
  }
  return null;
}

export function getForkComposerMenuItems(input: GetComposerMenuItemsInput): ForkComposerMenuItem[] {
  return forkComposerExtensions.flatMap((extension) => [...extension.getMenuItems(input)]);
}

export function isForkComposerMenuItem(item: {
  readonly type: string;
}): item is ForkComposerMenuItem {
  return forkComposerExtensions.some((extension) =>
    extension.triggerKinds.includes(item.type as ForkComposerTriggerKind),
  );
}

export function getForkComposerMenuGroup(
  triggerKind: string | null,
): { readonly id: string; readonly label: string } | null {
  return (
    forkComposerExtensions.find((extension) =>
      extension.triggerKinds.includes(triggerKind as ForkComposerTriggerKind),
    )?.menuGroup ?? null
  );
}

export function getForkComposerEmptyState(triggerKind: string | null): string | null {
  return (
    forkComposerExtensions.find((extension) =>
      extension.triggerKinds.includes(triggerKind as ForkComposerTriggerKind),
    )?.emptyState ?? null
  );
}

export function applyForkComposerMenuItem(input: ApplyComposerMenuItemInput): boolean {
  const extension = forkComposerExtensions.find((candidate) =>
    candidate.triggerKinds.includes(input.trigger.kind as ForkComposerTriggerKind),
  );
  return extension?.applyMenuItem(input) ?? false;
}

export function renderForkComposerMenuItemIcon(item: ForkComposerMenuItem) {
  const extension = forkComposerExtensions.find((candidate) =>
    candidate.triggerKinds.includes(item.type),
  );
  return extension?.renderIcon(item) ?? null;
}

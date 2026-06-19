import { type ChangeEvent, type KeyboardEvent, useState } from "react";

type CommitOnBlurElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * Buffer text input locally so keystrokes don't cause a settings-wide
 * re-render (and optionally a server RPC round-trip) on every character.
 * `onCommit` fires on blur and on Enter.
 *
 * The draft resynchronizes from the upstream `value` only when the input
 * is not focused, so an external push (e.g. an optimistic settings
 * update from the user's own commit, or a reset to defaults) doesn't
 * clobber an in-progress edit.
 *
 * Returns a bag of props that should be spread onto a text field:
 *
 *   const bag = useCommitOnBlur(instance.displayName ?? "", (next) => {...});
 *   <Input {...bag} placeholder="e.g. Work" />
 */
export function useCommitOnBlur<TElement extends CommitOnBlurElement = HTMLInputElement>(
  value: string,
  onCommit: (next: string) => void,
  options: { readonly commitOnEnter?: boolean } = {},
) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitOnEnter = options.commitOnEnter ?? true;

  return {
    value: draft ?? value,
    onChange: (event: ChangeEvent<TElement>) => {
      setDraft(event.target.value);
    },
    onFocus: () => {
      setDraft(value);
    },
    onBlur: () => {
      const next = draft ?? value;
      setDraft(null);
      if (next !== value) {
        onCommit(next);
      }
    },
    onKeyDown: (event: KeyboardEvent<TElement>) => {
      if (commitOnEnter && event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
}

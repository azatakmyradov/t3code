import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

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
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const commitOnEnter = options.commitOnEnter ?? true;

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value);
    }
  }, [value]);

  return {
    value: draft,
    onChange: (event: ChangeEvent<TElement>) => {
      setDraft(event.target.value);
    },
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      if (draft !== value) {
        onCommit(draft);
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

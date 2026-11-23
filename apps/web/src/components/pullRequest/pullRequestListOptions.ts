import type { MessageResolver } from "~/i18n/messages";

/** Static option tables hold `msg()` labels; components resolve them with `useMessages()`. */
export function resolveFilterOptions<Option extends { readonly label: string }>(
  options: ReadonlyArray<Option>,
  resolve: MessageResolver,
): Option[] {
  return options.map((option) => ({ ...option, label: resolve(option.label) }));
}

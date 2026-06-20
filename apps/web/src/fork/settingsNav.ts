import { ListTodoIcon, PaletteIcon, TextCursorInputIcon } from "lucide-react";

export const FORK_SETTINGS_NAV_ITEMS = [
  { label: "Appearance", to: "/settings/appearance", icon: PaletteIcon },
  { label: "Snippets", to: "/settings/snippets", icon: TextCursorInputIcon },
  { label: "Jira", to: "/settings/jira", icon: ListTodoIcon },
] as const;

import { ListTodoIcon, TextCursorInputIcon } from "lucide-react";

export const FORK_SETTINGS_NAV_ITEMS = [
  { label: "Snippets", to: "/settings/snippets", icon: TextCursorInputIcon },
  { label: "Jira", to: "/settings/jira", icon: ListTodoIcon },
] as const;

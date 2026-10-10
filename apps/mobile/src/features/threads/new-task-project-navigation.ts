import { StackActions, type NavigationState } from "@react-navigation/native";

/** A real stack entry gives folder selection native Back and swipe behavior. */
export function openProjectFolderPicker(folderScopeKey: string, incomingShareId?: string) {
  return StackActions.push("NewTask", {
    folderScopeKey,
    ...(incomingShareId ? { incomingShareId } : {}),
  });
}

/** Return through the project/folder picker to the draft it was opened from. */
export function returnToProjectPickerDraft(
  state: Pick<NavigationState, "routes" | "index"> | undefined,
) {
  if (!state) return null;
  let draftIndex = state.index - 1;
  while (draftIndex >= 0 && state.routes[draftIndex]?.name === "NewTask") draftIndex -= 1;
  return state.routes[draftIndex]?.name === "NewTaskDraft"
    ? StackActions.pop(state.index - draftIndex)
    : null;
}

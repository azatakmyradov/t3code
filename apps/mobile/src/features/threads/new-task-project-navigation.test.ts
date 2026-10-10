import * as NodeModule from "node:module";
import type { ParamListBase, StackNavigationState } from "@react-navigation/native";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@react-navigation/native", async () => {
  const { createRequire } = await import("node:module");
  const requireNavigation = createRequire(
    createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
  );
  return requireNavigation("@react-navigation/routers");
});
const requireNavigation = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
);
const { StackRouter, CommonActions } = requireNavigation("@react-navigation/routers") as {
  StackRouter: typeof import("@react-navigation/native").StackRouter;
  CommonActions: typeof import("@react-navigation/native").CommonActions;
};
import { openProjectFolderPicker, returnToProjectPickerDraft } from "./new-task-project-navigation";

const options = {
  routeNames: ["NewTask", "NewTaskDraft", "AddProject"],
  routeParamList: {},
  routeGetIdList: {},
};
const router = StackRouter({ initialRouteName: "NewTask" });
function history(routes: StackNavigationState<ParamListBase>["routes"]) {
  return { ...router.getInitialState(options), index: routes.length - 1, routes };
}
function apply(
  state: StackNavigationState<ParamListBase>,
  action: Parameters<typeof router.getStateForAction>[1],
) {
  const next = router.getStateForAction(state, action, options);
  return next ? router.getRehydratedState(next, options) : null;
}
const projectPicker = { key: "projects", name: "NewTask" };
const draft = { key: "draft", name: "NewTaskDraft", params: { projectId: "original" } };

it("native Back returns from folders to projects before dismissing the picker", () => {
  const projects = history([projectPicker]);
  const folders = apply(projects, openProjectFolderPicker("repo-group", "incoming-share"))!;
  expect(folders.routes).toHaveLength(2);
  expect(folders.routes[folders.index]?.params).toEqual({
    folderScopeKey: "repo-group",
    incomingShareId: "incoming-share",
  });
  const back = apply(folders, CommonActions.goBack())!;
  expect(back.routes).toEqual([projectPicker]);
  expect(apply(back, CommonActions.goBack())).toBeNull();
});

describe("return from project selection", () => {
  it.each([false, true])("returns to the existing draft with folder level %s", (withFolders) => {
    let state = history([draft, projectPicker]);
    if (withFolders) {
      state = apply(state, openProjectFolderPicker("repo-group"))!;
    }
    const action = returnToProjectPickerDraft(state)!;
    expect(apply(state, action)?.routes).toEqual([draft]);
  });

  it("starts a new draft when no existing draft precedes the picker", () => {
    const folders = apply(history([projectPicker]), openProjectFolderPicker("repo-group"))!;
    expect(returnToProjectPickerDraft(folders)).toBeNull();
  });
});

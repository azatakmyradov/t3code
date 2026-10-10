import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

const openProjectDraft = vi.hoisted(() => vi.fn(async () => null));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
}));
vi.mock("./useHandleNewThread", () => ({ useNewThreadHandler: () => openProjectDraft }));
vi.mock("~/state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("~/composerDraftStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/composerDraftStore")>();
  return {
    ...original,
    useComposerDraftStore: Object.assign(
      <T>(selector: (state: ReturnType<typeof original.useComposerDraftStore.getState>) => T) =>
        selector(original.useComposerDraftStore.getState()),
      original.useComposerDraftStore,
    ),
  };
});

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useSelectDraftProject } from "./useSelectDraftProject";

const environmentId = EnvironmentId.make("local");
const draftId = DraftId.make("source-draft");
const destinationDraftId = DraftId.make("destination-draft");
const sourceProjectRef = { environmentId, projectId: ProjectId.make("source") };
const destination: EnvironmentProject = {
  environmentId,
  id: ProjectId.make("destination"),
  title: "Destination",
  workspaceRoot: "/work/destination",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

beforeEach(() => {
  openProjectDraft.mockClear();
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyOptionsByModelByProvider: {},
    stickyActiveProvider: null,
  });
  const store = useComposerDraftStore.getState();
  store.setLogicalProjectDraftThreadId("source", sourceProjectRef, draftId, {
    threadId: ThreadId.make("source-thread"),
    environmentSelection: "auto",
    loadBalancedEnvironmentId: EnvironmentId.make("remote"),
  });
  store.setLogicalProjectDraftThreadId(
    "destination",
    { environmentId, projectId: destination.id },
    destinationDraftId,
    { threadId: ThreadId.make("destination-thread") },
  );
});

describe("draft project selection", () => {
  it("leaves empty source and destination draft records intact when opening a project", () => {
    const select = useSelectDraftProject(draftId);
    select(destination, "destination", true);
    const store = useComposerDraftStore.getState();
    expect(store.getDraftSessionByLogicalProjectKey("source")?.draftId).toBe(draftId);
    expect(store.getDraftSessionByLogicalProjectKey("destination")?.draftId).toBe(
      destinationDraftId,
    );
    expect(openProjectDraft).toHaveBeenCalledWith(
      { environmentId, projectId: destination.id },
      { environmentSelection: "manual" },
    );
  });

  it("retargets a populated draft in place and pins its exact folder", () => {
    useComposerDraftStore.getState().setPrompt(draftId, "Keep this prompt");
    useSelectDraftProject(draftId)(destination, "destination", true);
    const store = useComposerDraftStore.getState();
    expect(store.getDraftSessionByLogicalProjectKey("destination")).toMatchObject({
      draftId,
      projectId: destination.id,
      environmentSelection: "manual",
      loadBalancedEnvironmentId: null,
    });
    expect(store.getComposerDraft(draftId)?.prompt).toBe("Keep this prompt");
    expect(openProjectDraft).not.toHaveBeenCalled();
  });

  it("pins a reselected current folder that was chosen by auto balance", () => {
    const store = useComposerDraftStore.getState();
    store.setLogicalProjectDraftThreadId(
      "destination",
      { environmentId, projectId: destination.id },
      draftId,
      { environmentSelection: "auto", loadBalancedEnvironmentId: environmentId },
    );
    store.setPrompt(draftId, "Keep working here");
    useSelectDraftProject(draftId)(destination, "destination", true);
    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      projectId: destination.id,
      environmentSelection: "manual",
      loadBalancedEnvironmentId: null,
    });
  });

  it("ignores selection after a draft has been removed", () => {
    const select = useSelectDraftProject(draftId);
    useComposerDraftStore.getState().clearProjectDraftThreadById(sourceProjectRef, draftId);
    select(destination, "destination", true);
    expect(
      useComposerDraftStore.getState().getDraftSessionByLogicalProjectKey("destination")?.draftId,
    ).toBe(destinationDraftId);
    expect(openProjectDraft).not.toHaveBeenCalled();
  });
});

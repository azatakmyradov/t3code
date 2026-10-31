import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

const openProjectDraft = vi.hoisted(() => vi.fn(async () => null));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
}));
vi.mock("./useHandleNewThread", () => ({ useNewThreadHandler: () => openProjectDraft }));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: [] }),
  useEnvironmentProviders: () => new Map(),
}));
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
    useSelectDraftProject(draftId)(destination, "destination");
    const store = useComposerDraftStore.getState();
    expect(store.getDraftSessionByLogicalProjectKey("source")?.draftId).toBe(draftId);
    expect(store.getDraftSessionByLogicalProjectKey("destination")?.draftId).toBe(
      destinationDraftId,
    );
    expect(openProjectDraft).toHaveBeenCalledWith({ environmentId, projectId: destination.id });
  });

  it("retargets a populated draft in place", () => {
    useComposerDraftStore.getState().setPrompt(draftId, "Keep this prompt");
    useSelectDraftProject(draftId)(destination, "destination");
    const store = useComposerDraftStore.getState();
    expect(store.getDraftSessionByLogicalProjectKey("destination")).toMatchObject({
      draftId,
      projectId: destination.id,
    });
    expect(store.getComposerDraft(draftId)?.prompt).toBe("Keep this prompt");
    expect(openProjectDraft).not.toHaveBeenCalled();
  });

  it.each([
    [
      "removed",
      () => useComposerDraftStore.getState().clearProjectDraftThreadById(sourceProjectRef, draftId),
    ],
    ["promoted by Send", () => useComposerDraftStore.getState().markDraftThreadPromoting(draftId)],
  ])("ignores selection after a draft has been %s", (_, endSession) => {
    const select = useSelectDraftProject(draftId);
    endSession();
    select(destination, "destination");
    expect(
      useComposerDraftStore.getState().getDraftSessionByLogicalProjectKey("destination")?.draftId,
    ).toBe(destinationDraftId);
    expect(openProjectDraft).not.toHaveBeenCalled();
  });
});

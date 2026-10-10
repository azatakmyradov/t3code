import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import type { Project } from "~/types";
import { buildDraftProjectPickerItems } from "./DraftHeroHeadline.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const project = (id: string, workspaceRoot: string, environmentId = local): Project => ({
  id: ProjectId.make(id),
  environmentId,
  title: "Shared project",
  workspaceRoot,
  repositoryIdentity: {
    canonicalKey: "github.com/example/shared",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/example/shared.git",
    },
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
function entries(projects: readonly Project[]) {
  return buildSidebarProjectPickerEntries({
    groups: buildSidebarProjectSnapshots({
      projects,
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: local,
      resolveEnvironmentLabel: (id) => (id === local ? "Laptop" : "Remote server"),
    }),
    preferredProjectRef: null,
  });
}

describe("draft project search destinations", () => {
  it("keeps every same-machine folder selectable and makes its path searchable", () => {
    const projects = [project("one", "/work/one"), project("two", "/work/two")];
    const items = buildDraftProjectPickerItems(entries(projects), null);
    expect(items.map((item) => item.project.id)).toEqual(["one", "two"]);
    expect(new Set(items.map((item) => item.value)).size).toBe(2);
    expect(items.every((item) => item.exactFolder)).toBe(true);
    expect(items[1]?.searchText).toBe("Shared project /work/two Laptop");
  });

  it("keeps the preferred exact folder first and separates identical paths across machines", () => {
    const projects = [project("one", "/work/repo"), project("two", "/work/repo", remote)];
    const items = buildDraftProjectPickerItems(entries(projects), {
      environmentId: remote,
      projectId: ProjectId.make("two"),
    });
    expect(items.map((item) => item.project.environmentId)).toEqual([remote, local]);
    expect(items[0]?.searchText).toContain("Remote server");
    expect(items[0]?.value).not.toBe(items[1]?.value);
  });

  it("retains ordinary project selection for a single folder", () => {
    const pickerEntries = entries([project("one", "/work/one")]);
    const [item] = buildDraftProjectPickerItems(pickerEntries, null);
    expect(item?.value).toBe(pickerEntries[0]?.group.projectKey);
    expect(item?.exactFolder).toBe(false);
  });
});

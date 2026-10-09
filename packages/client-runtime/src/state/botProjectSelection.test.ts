import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  botProjectKey,
  botProjectOptions,
  filterBotProjectOptions,
  selectAllBotProjects,
  toggleBotProject,
} from "./bots.ts";

const laptop = EnvironmentId.make("laptop");
const remote = EnvironmentId.make("remote");
const access = (index: number, environmentId = laptop) => ({
  environmentId,
  projectId: ProjectId.make(`project-${index}`),
});
const project = (index: number, environmentId = laptop) => ({
  id: access(index).projectId,
  environmentId,
  title: `Project ${index}`,
  workspaceRoot: `/work/project-${index}`,
});
const environments = [
  { environmentId: laptop, label: "Laptop" },
  { environmentId: remote, label: "Build server" },
];

describe("bot project selection", () => {
  it("finds a project by environment, name, and path in a large catalog", () => {
    const options = botProjectOptions(
      Array.from({ length: 500 }, (_, index) => project(index, index % 2 ? remote : laptop)),
      environments,
      [],
    );
    const result = filterBotProjectOptions(options, new Set(), "server project-317", false);
    expect(result.map((item) => item.access)).toEqual([access(317, remote)]);
  });

  it("distinguishes identical project IDs across environments and filters the selected view", () => {
    const selected = [access(1, remote)];
    const options = botProjectOptions([project(1), project(1, remote)], environments, selected);
    expect(
      filterBotProjectOptions(options, new Set(selected.map(botProjectKey)), "", true).map(
        (item) => item.access,
      ),
    ).toEqual(selected);
  });

  it("keeps a disconnected selection removable while selecting available projects", () => {
    const disconnected = access(9, remote);
    const options = botProjectOptions([project(1)], environments, [disconnected]);
    const missing = options.find((item) => !item.available);
    expect(missing?.access).toEqual(disconnected);
    const all = selectAllBotProjects([disconnected], options);
    expect(all).toEqual([disconnected, access(1)]);
    expect(toggleBotProject(all, disconnected)).toEqual([access(1)]);
  });

  it("allows revoking access at the limit before choosing a replacement", () => {
    const selected = Array.from({ length: 100 }, (_, index) => access(index));
    expect(toggleBotProject(selected, access(100))).toEqual(selected);
    const reduced = toggleBotProject(selected, access(0));
    const replacement = toggleBotProject(reduced, access(100));
    expect(replacement).toHaveLength(100);
    expect(replacement).not.toContainEqual(access(0));
    expect(replacement).toContainEqual(access(100));
  });

  it("does not partially grant access when the entire catalog exceeds the limit", () => {
    const selected = [access(1)];
    const options = botProjectOptions(
      Array.from({ length: 101 }, (_, index) => project(index)),
      environments,
      selected,
    );
    expect(selectAllBotProjects(selected, options)).toEqual(selected);
  });

  it("selects the whole catalog without duplicating existing grants", () => {
    const selected = [access(1)];
    const options = botProjectOptions([project(1), project(2)], environments, selected);
    expect(selectAllBotProjects(selected, options)).toEqual([access(1), access(2)]);
  });
});

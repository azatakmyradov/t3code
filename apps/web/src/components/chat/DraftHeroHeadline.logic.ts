import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { buildProjectFolderChoices } from "@t3tools/client-runtime/state/project-grouping";
import type { SidebarProjectPickerEntry } from "~/sidebarProjectGrouping";

/** Search project names, folder paths and machines without losing the exact destination. */
export function buildDraftProjectPickerItems(
  entries: readonly SidebarProjectPickerEntry[],
  activeProjectRef: ScopedProjectRef | null,
) {
  return entries.flatMap(({ group, targetProject }) => {
    const exactFolder = group.memberProjects.length > 1;
    const projects = exactFolder
      ? buildProjectFolderChoices(group.memberProjects, activeProjectRef).flatMap(
          (choice) => choice.projects,
        )
      : [targetProject];
    return projects.map((project) => ({
      value: exactFolder
        ? `folder:${scopedProjectKey(scopeProjectRef(project.environmentId, project.id))}`
        : group.projectKey,
      label: group.displayName,
      searchText: `${group.displayName} ${project.workspaceRoot} ${project.environmentLabel ?? ""}`,
      projectKey: group.projectKey,
      project,
      exactFolder,
    }));
  });
}

import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useProjects } from "../../state/entities";

export function useBotProjects() {
  const projects = useProjects();
  const { scratchWorkspaceRootFor } = useScratchProject();
  return projects.filter(
    (project) =>
      !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)) &&
      // Imported development snapshots can retain the previous home's scratch project.
      !(project.title === "No project" && /[/\\]scratch[/\\]?$/.test(project.workspaceRoot)),
  );
}

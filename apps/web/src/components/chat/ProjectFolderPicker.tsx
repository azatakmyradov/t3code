import { useMemo } from "react";
import { FolderIcon } from "lucide-react";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { buildProjectFolderChoices } from "@t3tools/client-runtime/state/project-grouping";

import type { DraftId } from "~/composerDraftStore";
import { useSelectDraftProject } from "~/hooks/useSelectDraftProject";
import { useClientSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { useProject, useProjects } from "~/state/entities";
import { cn } from "~/lib/utils";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { buildProjectFolderLabels } from "./ProjectFolderPicker.logic";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
} from "./threadDetailsPanelStyles";

/** Choose a grouped project's folder on the current machine before starting a thread. */
export function ProjectFolderPicker({
  projectRef,
  draftId,
  locked,
  workspacePath,
}: {
  projectRef: ScopedProjectRef;
  draftId: DraftId | null;
  locked: boolean;
  workspacePath: string | null;
}) {
  const activeProject = useProject(projectRef);
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const selectDraftProject = useSelectDraftProject(draftId);
  const projectKey = activeProject
    ? deriveLogicalProjectKeyFromSettings(activeProject, settings)
    : null;
  const members = useMemo(
    () =>
      projectKey === null
        ? []
        : projects.filter(
            (project) => deriveLogicalProjectKeyFromSettings(project, settings) === projectKey,
          ),
    [projectKey, projects, settings],
  );
  const folders = useMemo(
    () =>
      buildProjectFolderChoices(members, projectRef).find(
        (choice) => choice.environmentId === projectRef.environmentId,
      )?.projects ?? [],
    [members, projectRef],
  );
  const path = draftId
    ? (activeProject?.workspaceRoot ?? "")
    : (workspacePath ?? activeProject?.workspaceRoot ?? "");
  const folderLabels = useMemo(
    () => buildProjectFolderLabels([...folders.map((folder) => folder.workspaceRoot), path]),
    [folders, path],
  );
  if (!activeProject || projectKey === null || members.length <= 1) return null;

  const canSelect = draftId !== null && !locked && folders.length > 1;
  const content = (
    <>
      <FolderIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span>Folder</span>
        <span className="flex w-full min-w-0 text-xs text-muted-foreground">
          <MiddleTruncate value={folderLabels.get(path) ?? path} showTitle={false} />
        </span>
      </span>
    </>
  );

  if (!canSelect) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className={cn(THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS, "flex h-auto py-1.5 sm:h-auto")}
              aria-label={`Folder: ${path}`}
            />
          }
        >
          {content}
        </TooltipTrigger>
        <TooltipPopup variant="code">{path}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={<ThreadDetailsControl part="select" multiline />}
              aria-label={`Choose folder: ${path}`}
            />
          }
        >
          {content}
        </TooltipTrigger>
        <TooltipPopup variant="code">{path}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" className="max-h-80 w-(--anchor-width) overflow-y-auto">
        <MenuRadioGroup value={activeProject.id}>
          {folders.map((folder) => (
            <MenuRadioItem
              key={folder.id}
              value={folder.id}
              aria-label={folder.workspaceRoot}
              closeOnClick
              onClick={() => selectDraftProject(folder, projectKey, true)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Tooltip>
                  <TooltipTrigger render={<span className="flex min-w-0 flex-1" />}>
                    <MiddleTruncate
                      value={folderLabels.get(folder.workspaceRoot) ?? folder.workspaceRoot}
                      showTitle={false}
                    />
                  </TooltipTrigger>
                  <TooltipPopup variant="code">{folder.workspaceRoot}</TooltipPopup>
                </Tooltip>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

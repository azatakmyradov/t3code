import type { DraftId } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { CheckIcon, FolderPlusIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useSelectDraftProject } from "~/hooks/useSelectDraftProject";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { buildDraftProjectPickerItems } from "./DraftHeroHeadline.logic";
import { MiddleTruncate } from "../ui/middle-truncate";

// Picker value for the "Add project" action; projects and exact folders use their own keys.
const ADD_PROJECT_VALUE = "add-project";

interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly searchText: string;
}

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const selectDraftProject = useSelectDraftProject(draftId);
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;
  // The project that hosts threads without a project is not a row: the line
  // under the headline is the way into it.
  const menuEntries = useMemo(
    () =>
      projectPickerEntries.filter(
        ({ targetProject }) =>
          !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
      ),
    [projectPickerEntries, scratchWorkspaceRootFor],
  );
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(
    activeProjectRef?.environmentId ?? primaryEnvironmentId,
  );
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null && isScratchProject(activeProject, scratchWorkspaceRoot);

  // {value, label} items let Base UI drive the combobox selection while the
  // popup search filters the same collection. "Add project" is an action, not
  // a project, so it only trails the unfiltered list.
  const projectPickerItems = useMemo(
    () => buildDraftProjectPickerItems(menuEntries, activeProjectRef),
    [activeProjectRef, menuEntries],
  );
  const projectItemByValue = useMemo(
    () => new Map(projectPickerItems.map((item) => [item.value, item] as const)),
    [projectPickerItems],
  );
  const pickerItems = useMemo<readonly PickerItem[]>(
    () => [
      ...projectPickerItems,
      { value: ADD_PROJECT_VALUE, label: "Add project", searchText: "Add project" },
    ],
    [projectPickerItems],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerFilter = useComboboxFilter();
  const filteredPickerItems = useMemo(() => {
    const query = pickerQuery.trim();
    if (query.length === 0) return pickerItems;
    return pickerItems.filter(
      (item) =>
        item.value !== ADD_PROJECT_VALUE &&
        pickerFilter.contains(item, query, (candidate) => candidate.searchText),
    );
  }, [pickerFilter, pickerItems, pickerQuery]);
  const selectedPickerItem =
    projectPickerItems.find((item) =>
      item.exactFolder
        ? activeProjectRef !== null &&
          scopedProjectKey(scopeProjectRef(item.project.environmentId, item.project.id)) ===
            scopedProjectKey(activeProjectRef)
        : item.projectKey === activeProjectKey,
    ) ?? null;

  // The picker can change the draft's target while the no-project home is
  // still being opened; a stale continuation must not retarget it again.
  const activePhysicalProjectKey = activeProjectRef ? scopedProjectKey(activeProjectRef) : null;
  const latestTargetRef = useRef({
    draftId,
    activeProjectKey,
    activePhysicalProjectKey,
    scratchTargetEnvironmentId,
  });
  useEffect(() => {
    latestTargetRef.current = {
      draftId,
      activeProjectKey,
      activePhysicalProjectKey,
      scratchTargetEnvironmentId,
    };
  }, [activeProjectKey, activePhysicalProjectKey, scratchTargetEnvironmentId, draftId]);
  const selectProject = (
    project: (typeof projects)[number],
    logicalProjectKey: string,
    exactFolder = false,
  ) => {
    if (!draftId) return;
    latestTargetRef.current = {
      draftId,
      activeProjectKey: logicalProjectKey,
      activePhysicalProjectKey: scopedProjectKey(
        scopeProjectRef(project.environmentId, project.id),
      ),
      scratchTargetEnvironmentId: project.environmentId,
    };
    selectDraftProject(project, logicalProjectKey, exactFolder);
  };
  const startScratch = async (): Promise<boolean> => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) {
      return false;
    }
    const requested = {
      draftId,
      activeProjectKey,
      activePhysicalProjectKey,
      scratchTargetEnvironmentId,
    };
    const project = await openScratchProject(scratchTargetEnvironmentId);
    const latest = latestTargetRef.current;
    if (
      !project ||
      latest.draftId !== requested.draftId ||
      latest.activeProjectKey !== requested.activeProjectKey ||
      latest.activePhysicalProjectKey !== requested.activePhysicalProjectKey ||
      latest.scratchTargetEnvironmentId !== requested.scratchTargetEnvironmentId
    ) {
      return false;
    }
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
    return true;
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Combobox
      items={pickerItems}
      filteredItems={filteredPickerItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={pickerOpen}
      onOpenChange={(open) => {
        setPickerOpen(open);
        setPickerQuery("");
      }}
      value={selectedPickerItem}
      onValueChange={(item) => {
        if (!item) return;
        setPickerOpen(false);
        if (item.value === ADD_PROJECT_VALUE) {
          openAddProject();
          return;
        }
        const target = projectItemByValue.get(item.value);
        if (!target || (!target.exactFolder && item.value === selectedPickerItem?.value)) return;
        selectProject(target.project, target.projectKey, target.exactFolder);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            // The trigger's accessible name comes from its visible text (the
            // project title) so the hero sentence reads naturally: an
            // aria-label here would replace the title with an action phrase
            // mid-sentence and baffle screen-reader users.
            <ComboboxTrigger
              render={<InlineButton tone="picker" />}
              data-draft-project-trigger=""
              className="pointer-events-auto max-w-64 align-baseline"
            />
          }
        >
          <span className="min-w-0 truncate">
            {isScratchDraft ? "No project" : (activeProjectDisplayName ?? "Choose a project")}
          </span>
        </TooltipTrigger>
        {activeProjectDisplayName && !isScratchDraft ? (
          <TooltipPopup side="top">{activeProjectDisplayName}</TooltipPopup>
        ) : null}
      </Tooltip>
      <ComboboxPopup align="center" className="w-72 overflow-hidden">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects..."
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) => {
            const target = projectItemByValue.get(item.value);
            const entry = target ? projectEntryByKey.get(target.projectKey) : undefined;
            return (
              <ComboboxItem key={item.value} hideIndicator value={item}>
                {item.value === ADD_PROJECT_VALUE ? (
                  <FolderPlusIcon className="size-4 shrink-0" />
                ) : entry ? (
                  <ProjectFavicon project={entry.group} className="size-4 shrink-0" />
                ) : null}
                <Tooltip>
                  <TooltipTrigger render={<span className="min-w-0 flex-1 text-sm" />}>
                    <span className="block truncate">{item.label}</span>
                    {target?.exactFolder ? (
                      <span className="flex min-w-0 text-xs text-muted-foreground">
                        <MiddleTruncate value={target.project.workspaceRoot} showTitle={false} />
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    {target?.exactFolder ? target.searchText : item.label}
                  </TooltipPopup>
                </Tooltip>
                {target?.exactFolder ? (
                  <>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {target.project.environmentLabel ?? "Remote"}
                    </span>
                    {item.value === selectedPickerItem?.value ? (
                      <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
                    ) : null}
                  </>
                ) : entry && showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={entry.group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  // The composer hero is a sentence, so the heading's accessible name must be
  // a complete sentence too. The project picker is a control rendered inline
  // in the h1; without an explicit label its widget state bleeds into the
  // announced phrase.
  const headingLabel = isScratchDraft
    ? "What should we work on?"
    : hasResolvedProject
      ? `What should we build in ${activeProjectDisplayName}?`
      : canChooseProject
        ? `${activeProjectDisplayName ?? "Choose a project"} to start`
        : "Add a project to start";

  // One click out of the project, phrased as the alternative to the question
  // above it. Focus moves to the project picker once this line has gone.
  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");
  const orStartWithoutProject =
    scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              tone="muted"
              className="pointer-events-auto"
              onClick={() =>
                void startScratch().then((started) => {
                  if (started) {
                    document.querySelector<HTMLElement>("[data-draft-project-trigger]")?.focus();
                  }
                })
              }
            />
          }
        >
          or start without a project
        </TooltipTrigger>
        {noProjectShortcut ? <TooltipPopup side="bottom">{noProjectShortcut}</TooltipPopup> : null}
      </Tooltip>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      <h1
        aria-label={headingLabel}
        className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl"
      >
        {isScratchDraft ? (
          <>What should we work on?</>
        ) : hasResolvedProject ? (
          <>What should we build in {projectSelector}?</>
        ) : canChooseProject ? (
          <>{projectSelector} to start</>
        ) : (
          <>Add a project to start</>
        )}
      </h1>
      {activeProjectGroup && activeProjectGroup.memberProjects.length > 1 && activeProject ? (
        <Tooltip>
          <TooltipTrigger
            render={<p className="mt-2 flex max-w-full text-sm text-muted-foreground" />}
          >
            <MiddleTruncate value={activeProject.workspaceRoot} showTitle={false} />
          </TooltipTrigger>
          <TooltipPopup>{activeProject.workspaceRoot}</TooltipPopup>
        </Tooltip>
      ) : null}
      {/* Reserved whenever threads can skip a project, so the heading does not
          move. Without a project, the picker moves here to choose one. */}
      {scratchWorkspaceRoot === null ? null : (
        <p className="mt-2 flex h-6 items-center text-sm">
          {isScratchDraft ? projectSelector : orStartWithoutProject}
        </p>
      )}
    </div>
  );
}

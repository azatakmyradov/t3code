import { Link } from "@tanstack/react-router";
import type {
  EnvironmentId,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPageFilters,
  ServerSettings,
} from "@t3tools/contracts";
import { DEFAULT_JIRA_PAGE_FILTERS, isJiraServiceDeskProjectType } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { type CSSProperties, useCallback, useMemo, useState } from "react";

import { Button } from "../../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menu";
import { PanelResizeHandle } from "../../components/ui/panel-resize-handle";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../../components/ui/select";
import { SidebarInset, SidebarTrigger } from "../../components/ui/sidebar";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import {
  useClientSettingsHydrated,
  usePrimarySettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { isElectron } from "../../env";
import { isJiraConfigured } from "./jiraConfig";
import { jiraEnvironment, useJiraIssuePages } from "./jiraState";
import { JiraCommentsPanel } from "./JiraCommentsPanel";
import { JiraIssueFields } from "./JiraIssueFieldRows";
import { JiraAdfRenderer } from "./JiraRichText";
import { buildJiraPageFilterJql } from "./jiraFilters";
import { rankJiraIssues } from "./jiraSearch";

type FilterOption<T extends string> = {
  readonly value: T;
  readonly label: string;
};

const STATUS_OPTIONS = [
  { value: "unresolved", label: "Unresolved" },
  { value: "all", label: "Any status" },
  { value: "todo", label: "To Do" },
  { value: "inProgress", label: "In progress" },
  { value: "done", label: "Done" },
] as const satisfies ReadonlyArray<FilterOption<JiraPageFilters["status"]>>;

const ASSIGNEE_OPTIONS = [
  { value: "currentUser", label: "Me" },
  { value: "any", label: "Anyone" },
  { value: "unassigned", label: "Unassigned" },
] as const satisfies ReadonlyArray<FilterOption<JiraPageFilters["assignee"]>>;

const UPDATED_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const satisfies ReadonlyArray<FilterOption<JiraPageFilters["updated"]>>;

const SORT_OPTIONS = [
  { value: "updatedDesc", label: "Updated newest" },
  { value: "updatedAsc", label: "Updated oldest" },
  { value: "createdDesc", label: "Created newest" },
] as const satisfies ReadonlyArray<FilterOption<JiraPageFilters["sort"]>>;

const ALL_SPACES_VALUE = "__all_spaces__";
const JIRA_ISSUE_LIST_WIDTH_STORAGE_KEY = "t3code:jira-page-issue-list-width";
const JIRA_ISSUE_LIST_DEFAULT_WIDTH = 320;
const JIRA_ISSUE_LIST_MIN_WIDTH = 256;
const JIRA_ISSUE_LIST_MAX_WIDTH = 480;

function JiraFilterSelect<TValue extends string>(props: {
  readonly label: string;
  readonly value: TValue;
  readonly options: ReadonlyArray<FilterOption<TValue>>;
  readonly onChange: (value: TValue) => void;
  readonly className?: string | undefined;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (typeof value === "string") {
          props.onChange(value as TValue);
        }
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn("w-auto min-w-[8.75rem] gap-2 rounded-md", props.className)}
      >
        <span className="shrink-0 text-muted-foreground">{props.label}</span>
        <span className="min-w-0 truncate">{labelFor(props.options, props.value)}</span>
      </SelectTrigger>
      <SelectPopup matchTriggerWidth={false} className="min-w-44">
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function labelFor<TValue extends string>(
  options: ReadonlyArray<FilterOption<TValue>>,
  value: TValue,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function buildSpaceOptions(
  issues: ReadonlyArray<JiraIssueSummary>,
  selectedSpace: string,
): Array<FilterOption<string>> {
  const spaces = new Set<string>();
  for (const issue of issues) {
    spaces.add(issue.project);
  }
  if (selectedSpace) {
    spaces.add(selectedSpace);
  }
  return [
    { value: ALL_SPACES_VALUE, label: "All spaces" },
    ...Array.from(spaces)
      .toSorted((left, right) => left.localeCompare(right))
      .map((space) => ({
        value: space,
        label: space,
      })),
  ];
}

function JiraMoreFiltersMenu(props: {
  readonly filters: JiraPageFilters;
  readonly patchFilters: (patch: Partial<JiraPageFilters>) => void;
}) {
  const moreActive =
    props.filters.updated !== DEFAULT_JIRA_PAGE_FILTERS.updated ||
    props.filters.sort !== DEFAULT_JIRA_PAGE_FILTERS.sort;
  const label = moreActive
    ? `${labelFor(UPDATED_OPTIONS, props.filters.updated)}, ${labelFor(SORT_OPTIONS, props.filters.sort)}`
    : "More filters";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" className="h-8 shrink-0 rounded-md px-3" />}
      >
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDownIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={props.filters.updated}
          onValueChange={(value) => {
            if (typeof value === "string") {
              props.patchFilters({ updated: value as JiraPageFilters["updated"] });
            }
          }}
        >
          <DropdownMenuLabel>Updated</DropdownMenuLabel>
          {UPDATED_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={props.filters.sort}
          onValueChange={(value) => {
            if (typeof value === "string") {
              props.patchFilters({ sort: value as JiraPageFilters["sort"] });
            }
          }}
        >
          <DropdownMenuLabel>Sort</DropdownMenuLabel>
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => props.patchFilters(DEFAULT_JIRA_PAGE_FILTERS)}>
          <XIcon className="size-4" />
          Reset filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function relativeUpdated(updated: string): string {
  return updated ? formatRelativeTimeLabel(updated) : "";
}

function JiraDetailPane(props: {
  readonly issue: JiraIssueSummary | null;
  readonly detail: JiraIssueDetail | null;
  readonly isPending: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly onIssueChanged: () => void;
  readonly onIssueListChanged: () => void;
}) {
  const issue = props.detail ?? props.issue;
  if (!issue) {
    return (
      <aside className="flex min-h-0 flex-1 items-center justify-center border-l border-border bg-background px-6 text-sm text-muted-foreground">
        Select a ticket.
      </aside>
    );
  }

  const updated = relativeUpdated(issue.updated);
  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l border-border bg-background">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs font-medium">
            {issue.key}
          </span>
          {props.isPending ? (
            <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <h2 className="mt-3 text-base font-semibold leading-snug text-foreground">
          {issue.summary}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <JiraIssueFields
          environmentId={props.environmentId}
          settings={props.settings}
          issue={issue}
          detail={props.detail}
          updatedLabel={updated}
          onIssueChanged={props.onIssueChanged}
          onIssueListChanged={props.onIssueListChanged}
        />
        {props.detail?.description ? (
          <div className="mt-5 border-t border-border/60 pt-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Description</h3>
            <JiraAdfRenderer
              document={props.detail.description}
              mediaResolutions={props.detail.descriptionMediaResolutions}
            />
          </div>
        ) : null}
        <div className="mt-5 border-t border-border/60 pt-4">
          <JiraCommentsPanel
            environmentId={props.environmentId}
            issueIdOrKey={issue.key}
            settings={props.settings}
            isServiceDesk={isJiraServiceDeskProjectType(
              props.detail?.projectTypeKey ?? props.issue?.projectTypeKey,
            )}
            onMutated={props.onIssueChanged}
          />
        </div>
      </div>
      <div className="flex items-center border-t border-border px-5 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          render={
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${issue.key} in Jira`}
            />
          }
        >
          <ExternalLinkIcon className="size-4" />
          Open in Jira
        </Button>
      </div>
    </aside>
  );
}

export function JiraPage() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const clientSettingsHydrated = useClientSettingsHydrated();
  const primaryEnvironment = usePrimaryEnvironment();
  const configured = isJiraConfigured(settings);
  const filters = settings.jiraPageFilters;
  const filterJql = useMemo(() => buildJiraPageFilterJql(filters), [filters]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const { width: issueListWidth, handlers: issueListResizeHandlers } = useResizableWidth({
    storageKey: JIRA_ISSUE_LIST_WIDTH_STORAGE_KEY,
    defaultWidth: JIRA_ISSUE_LIST_DEFAULT_WIDTH,
    minWidth: JIRA_ISSUE_LIST_MIN_WIDTH,
    maxWidth: JIRA_ISSUE_LIST_MAX_WIDTH,
    edge: "right",
  });
  const patchFilters = useCallback(
    (patch: Partial<JiraPageFilters>) => {
      setSelectedIssueKey(null);
      updateSettings({
        jiraPageFilters: {
          ...filters,
          ...patch,
        },
      });
    },
    [filters, updateSettings],
  );
  const issuePages = useJiraIssuePages({
    environmentId: clientSettingsHydrated ? (primaryEnvironment?.environmentId ?? null) : null,
    settings,
    jql: filterJql,
  });
  const spaceOptions = useMemo(
    () => buildSpaceOptions(issuePages.issues, filters.space),
    [filters.space, issuePages.issues],
  );
  const spaceFilteredIssues = useMemo(
    () =>
      filters.space
        ? issuePages.issues.filter((issue) => issue.project === filters.space)
        : issuePages.issues,
    [filters.space, issuePages.issues],
  );
  const filteredIssues = useMemo(
    () => rankJiraIssues(spaceFilteredIssues, searchQuery),
    [searchQuery, spaceFilteredIssues],
  );
  const selectedIssue =
    filteredIssues.find((issue) => issue.key === selectedIssueKey) ?? filteredIssues[0] ?? null;
  const detailQuery = useEnvironmentQuery(
    primaryEnvironment && configured && selectedIssue
      ? jiraEnvironment.getIssue({
          environmentId: primaryEnvironment.environmentId,
          input: { issueIdOrKey: selectedIssue.key },
        })
      : null,
  );

  if (!configured) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full flex-col">
          {!isElectron ? (
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <SidebarTrigger className="size-7 md:hidden" />
              <span className="text-sm font-medium">Jira</span>
            </header>
          ) : null}
          <main className="flex flex-1 items-center justify-center px-4">
            <div className="max-w-sm rounded-lg border border-border bg-card p-5 shadow-sm/4">
              <h1 className="text-base font-semibold">Configure Jira</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your Jira Cloud site, Atlassian email, and API token to view tickets here.
              </p>
              <Button size="sm" className="mt-4" render={<Link to="/settings/jira" />}>
                Open Jira settings
              </Button>
            </div>
          </main>
        </div>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-w-0 flex-col">
        <header
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border px-3",
            isElectron ? "drag-region h-[52px]" : "h-11",
          )}
        >
          {!isElectron ? <SidebarTrigger className="size-7 md:hidden" /> : null}
          <span className="text-sm font-medium">Jira</span>
          <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto">
            <JiraFilterSelect
              label="Spaces"
              value={filters.space || ALL_SPACES_VALUE}
              options={spaceOptions}
              onChange={(space) => patchFilters({ space: space === ALL_SPACES_VALUE ? "" : space })}
              className="min-w-[11rem]"
            />
            <JiraFilterSelect
              label="Status"
              value={filters.status}
              options={STATUS_OPTIONS}
              onChange={(status) => patchFilters({ status })}
            />
            <JiraFilterSelect
              label="Assignee"
              value={filters.assignee}
              options={ASSIGNEE_OPTIONS}
              onChange={(assignee) => patchFilters({ assignee })}
            />
            <JiraMoreFiltersMenu filters={filters} patchFilters={patchFilters} />
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Refresh Jira issues"
              disabled={!clientSettingsHydrated}
              onClick={issuePages.refresh}
            >
              <RefreshCwIcon className={cn("size-4", issuePages.isPending && "animate-spin")} />
            </Button>
          </div>
        </header>
        <main className="flex min-h-0 min-w-0 flex-1">
          <section
            className="relative flex w-[min(var(--jira-issue-list-width),48vw)] min-w-64 max-w-[30rem] shrink-0 flex-col border-r border-border bg-muted/20 max-[760px]:w-[min(var(--jira-issue-list-width),72vw)] max-[760px]:min-w-0"
            style={
              {
                "--jira-issue-list-width": `${issueListWidth}px`,
              } as CSSProperties
            }
          >
            <PanelResizeHandle
              edge="right"
              label="Resize Jira issue list"
              handlers={issueListResizeHandlers}
            />
            <div className="border-b border-border bg-background/80 p-2">
              <InputGroup className="h-8 w-full rounded-md">
                <InputGroupAddon>
                  <SearchIcon className="size-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  size="sm"
                  placeholder="Search work"
                  value={searchQuery}
                  onChange={(event) => {
                    setSelectedIssueKey(null);
                    setSearchQuery(event.currentTarget.value);
                  }}
                />
                {searchQuery.trim().length > 0 ? (
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Clear Jira search"
                      onClick={() => {
                        setSelectedIssueKey(null);
                        setSearchQuery("");
                      }}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
            </div>
            {issuePages.error ? (
              <div className="border-b border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                {issuePages.error}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredIssues.map((issue) => {
                const active = issue.key === selectedIssue?.key;
                return (
                  <button
                    key={issue.key}
                    type="button"
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border/70 px-4 py-3 text-left hover:bg-accent/60",
                      active && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => setSelectedIssueKey(issue.key)}
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-medium">{issue.key}</span>
                      <span className="mt-1 block truncate text-sm font-medium">
                        {issue.summary}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {issue.status.name} · {issue.project}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {relativeUpdated(issue.updated)}
                    </span>
                  </button>
                );
              })}
              {filteredIssues.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {!clientSettingsHydrated || issuePages.isPending
                    ? "Loading Jira tickets..."
                    : "No Jira tickets found."}
                </div>
              ) : null}
            </div>
            {issuePages.nextPageToken ? (
              <div className="border-t border-border p-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={issuePages.isPending}
                  onClick={issuePages.loadNext}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </section>
          <JiraDetailPane
            issue={selectedIssue}
            detail={detailQuery.data}
            isPending={detailQuery.isPending}
            environmentId={primaryEnvironment?.environmentId ?? null}
            settings={settings}
            onIssueChanged={detailQuery.refresh}
            onIssueListChanged={issuePages.refresh}
          />
        </main>
      </div>
    </SidebarInset>
  );
}

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  JiraEditableIssueFields,
  JiraIssueDetail,
  JiraIssueFieldOption,
  JiraIssueSummary,
  JiraIssueTransition,
  JiraIssueTransitionField,
  JiraIssueUser,
  ServerSettings,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  LoaderIcon,
  SearchIcon,
  UserCircleIcon,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../../components/ui/select";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  classifyJiraTransitionAction,
  getRequiredSupportedTransitionFields,
  refreshJiraIssueMutationQueries,
  transitionHasUnsupportedRequiredFields,
} from "./jiraIssueFields";
import { jiraEnvironment, useJiraAssignableUserSearch } from "./jiraState";

const NONE_PRIORITY_VALUE = "__none_priority__";

type SavingField = "status" | "assignee" | "priority";

function DetailRow(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-t border-border/60 py-2 first:border-t-0">
      <dt className="text-xs font-medium text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 text-xs text-foreground">{props.children}</dd>
    </div>
  );
}

function ReadOnlyValue(props: { readonly value: string | null; readonly fallback?: string }) {
  return (
    <span className="block min-w-0 truncate">{props.value || props.fallback || "Unassigned"}</span>
  );
}

const FieldButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    readonly children: ReactNode;
    readonly isSaving?: boolean;
  }
>(function FieldButton({ children, className, disabled, isSaving, ...props }, ref) {
  return (
    <Button
      ref={ref}
      {...props}
      size="sm"
      variant="ghost"
      className={cn(
        "h-6 min-w-0 max-w-full justify-start gap-1.5 rounded-md px-1.5 text-xs font-normal",
        className,
      )}
      disabled={disabled}
    >
      <span className="min-w-0 truncate">{children}</span>
      {isSaving ? (
        <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <ChevronDownIcon className="size-3 text-muted-foreground" />
      )}
    </Button>
  );
});

function UserAvatar(props: { readonly user: JiraIssueUser | null }) {
  if (props.user?.avatarUrl) {
    return (
      <img
        src={props.user.avatarUrl}
        alt=""
        className="size-5 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  const initial = props.user?.displayName.trim().charAt(0).toUpperCase() || "";
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6rem] font-medium text-muted-foreground">
      {initial || <UserCircleIcon className="size-3.5" />}
    </span>
  );
}

function errorToast(title: string, error: unknown, fallback: string) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : fallback,
    }),
  );
}

function optionName(
  options: ReadonlyArray<JiraIssueFieldOption>,
  id: string | null,
): string | null {
  if (id === null) return null;
  return options.find((option) => option.id === id)?.name ?? null;
}

function AssigneePicker(props: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly issueIdOrKey: string;
  readonly selectedUser: JiraIssueUser | null;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly isSaving: boolean;
  readonly onSelect: (accountId: string | null, user: JiraIssueUser | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useJiraAssignableUserSearch({
    environmentId: props.environmentId,
    settings: props.settings,
    issueIdOrKey: props.issueIdOrKey,
    query,
    enabled: open,
  });

  const users = useMemo(() => {
    const byAccount = new Map<string, JiraIssueUser>();
    if (props.selectedUser?.accountId) {
      byAccount.set(props.selectedUser.accountId, props.selectedUser);
    }
    for (const user of search.users) {
      if (user.accountId) {
        byAccount.set(user.accountId, user);
      }
    }
    return [...byAccount.values()];
  }, [props.selectedUser, search.users]);

  const selectUser = useCallback(
    (accountId: string | null, user: JiraIssueUser | null) => {
      setOpen(false);
      setQuery("");
      props.onSelect(accountId, user);
    },
    [props.onSelect],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <FieldButton disabled={props.disabled} isSaving={props.isSaving}>
            {props.selectedUser?.displayName ?? "Unassigned"}
          </FieldButton>
        }
      />
      <PopoverPopup align="start" className="w-72" sideOffset={6} viewportClassName="p-2">
        <InputGroup className="h-8 rounded-md">
          <InputGroupAddon>
            <SearchIcon className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            size="sm"
            value={query}
            placeholder="Search assignees"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </InputGroup>
        <div className="mt-2 max-h-64 overflow-y-auto">
          {!props.required ? (
            <button
              type="button"
              className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => selectUser(null, null)}
            >
              <UserAvatar user={null} />
              <span className="min-w-0 truncate">Unassigned</span>
            </button>
          ) : null}
          {users.map((user) => (
            <button
              key={user.accountId}
              type="button"
              className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => selectUser(user.accountId, user)}
            >
              <UserAvatar user={user} />
              <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
            </button>
          ))}
          {search.isPending ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <LoaderIcon className="size-3 animate-spin" />
              Loading assignees
            </div>
          ) : users.length === 0 && props.required ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No assignable users found.</p>
          ) : null}
          {search.error ? (
            <p className="px-2 py-2 text-xs text-destructive">{search.error}</p>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function StatusField(props: {
  readonly issue: JiraIssueSummary | JiraIssueDetail;
  readonly transitions: ReadonlyArray<JiraIssueTransition>;
  readonly isPending: boolean;
  readonly isSaving: boolean;
  readonly onApply: (transition: JiraIssueTransition) => void;
  readonly onOpenDialog: (transition: JiraIssueTransition) => void;
}) {
  const hasUnsupportedTransitions = props.transitions.some(transitionHasUnsupportedRequiredFields);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <FieldButton disabled={props.isPending || props.isSaving} isSaving={props.isSaving}>
            {props.issue.status.name}
          </FieldButton>
        }
      />
      <DropdownMenuContent align="start" className="w-72">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Change status</div>
        {props.transitions.length === 0 ? (
          <DropdownMenuItem disabled>No available transitions</DropdownMenuItem>
        ) : (
          props.transitions.map((transition) => {
            const unsupported = transitionHasUnsupportedRequiredFields(transition);
            return (
              <DropdownMenuItem
                key={transition.id}
                disabled={props.isSaving || unsupported}
                onClick={() => {
                  const action = classifyJiraTransitionAction(transition);
                  if (action === "apply") {
                    props.onApply(transition);
                    return;
                  }
                  if (action === "dialog") {
                    props.onOpenDialog(transition);
                  }
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{transition.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    to {transition.to.name}
                    {unsupported
                      ? `, requires ${transition.unsupportedRequiredFieldIds.join(", ")}`
                      : ""}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
        {hasUnsupportedTransitions ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.open(props.issue.url, "_blank", "noreferrer")}>
              <ExternalLinkIcon className="size-4" />
              Open in Jira
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityField(props: {
  readonly issue: JiraIssueSummary | JiraIssueDetail;
  readonly metadata: JiraEditableIssueFields | null;
  readonly isPending: boolean;
  readonly isSaving: boolean;
  readonly onChange: (priorityId: string | null) => void;
}) {
  const priority = props.metadata?.priority ?? null;
  const editable = priority?.editable === true;
  const required = priority?.required === true;
  const options = priority?.allowedValues ?? [];
  const value = props.issue.priorityId ?? NONE_PRIORITY_VALUE;

  if (!editable || options.length === 0) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <ReadOnlyValue value={props.issue.priority} fallback="None" />
        {props.isPending ? (
          <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </span>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (typeof nextValue !== "string") return;
        const priorityId = nextValue === NONE_PRIORITY_VALUE ? null : nextValue;
        if (priorityId === props.issue.priorityId) return;
        props.onChange(priorityId);
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-6 min-h-6 w-auto max-w-full gap-1.5 rounded-md border-transparent bg-transparent px-1.5 text-xs shadow-none before:hidden"
        disabled={props.isSaving}
      >
        <span className="min-w-0 truncate">
          {optionName(options, props.issue.priorityId) ?? props.issue.priority ?? "None"}
        </span>
        {props.isSaving ? (
          <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </SelectTrigger>
      <SelectPopup matchTriggerWidth={false} className="min-w-40">
        {!required ? <SelectItem value={NONE_PRIORITY_VALUE}>None</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

type TransitionDraft = {
  readonly resolutionId: string;
  readonly assigneeAccountId: string | null;
  readonly assigneeUser: JiraIssueUser | null;
  readonly priorityId: string;
};

function defaultTransitionDraft(
  issue: JiraIssueSummary | JiraIssueDetail,
  fields: ReadonlyArray<JiraIssueTransitionField>,
): TransitionDraft {
  const resolution = fields.find((field) => field.id === "resolution");
  const priority = fields.find((field) => field.id === "priority");
  const priorityId =
    issue.priorityId && priority?.allowedValues.some((option) => option.id === issue.priorityId)
      ? issue.priorityId
      : (priority?.allowedValues[0]?.id ?? "");
  return {
    resolutionId: resolution?.allowedValues[0]?.id ?? "",
    assigneeAccountId: issue.assignee?.accountId ?? null,
    assigneeUser: issue.assignee,
    priorityId,
  };
}

function transitionDraftComplete(
  fields: ReadonlyArray<JiraIssueTransitionField>,
  draft: TransitionDraft,
): boolean {
  for (const field of fields) {
    if (field.id === "resolution" && !draft.resolutionId) return false;
    if (field.id === "priority" && !draft.priorityId) return false;
    if (field.id === "assignee" && !draft.assigneeAccountId) return false;
  }
  return true;
}

function TransitionDialog(props: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly issue: JiraIssueSummary | JiraIssueDetail;
  readonly transition: JiraIssueTransition | null;
  readonly isSaving: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (
    transition: JiraIssueTransition,
    fields: {
      readonly resolutionId?: string;
      readonly assigneeAccountId?: string | null;
      readonly priorityId?: string;
    },
  ) => void;
}) {
  const requiredFields = useMemo(
    () => (props.transition ? getRequiredSupportedTransitionFields(props.transition) : []),
    [props.transition],
  );
  const [draft, setDraft] = useState<TransitionDraft>(() =>
    defaultTransitionDraft(props.issue, requiredFields),
  );

  useEffect(() => {
    if (!props.transition) return;
    setDraft(defaultTransitionDraft(props.issue, requiredFields));
  }, [props.issue, props.transition, requiredFields]);

  const canSubmit =
    props.transition !== null && !props.isSaving && transitionDraftComplete(requiredFields, draft);

  return (
    <Dialog
      open={props.transition !== null}
      onOpenChange={(open) => {
        if (!open && !props.isSaving) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.transition?.name ?? "Transition issue"}</DialogTitle>
          <DialogDescription>
            Set the required fields for {props.issue.key} before moving it to{" "}
            {props.transition?.to.name ?? "the next status"}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {requiredFields.map((field) => {
            if (field.id === "resolution") {
              return (
                <div className="grid gap-1.5" key={field.id}>
                  <span className="text-xs font-medium text-foreground">{field.name}</span>
                  <Select
                    value={draft.resolutionId}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        setDraft((current) => ({ ...current, resolutionId: value }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <span className="truncate">
                        {optionName(field.allowedValues, draft.resolutionId) ?? "Select resolution"}
                      </span>
                    </SelectTrigger>
                    <SelectPopup>
                      {field.allowedValues.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              );
            }
            if (field.id === "priority") {
              return (
                <div className="grid gap-1.5" key={field.id}>
                  <span className="text-xs font-medium text-foreground">{field.name}</span>
                  <Select
                    value={draft.priorityId}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        setDraft((current) => ({ ...current, priorityId: value }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <span className="truncate">
                        {optionName(field.allowedValues, draft.priorityId) ?? "Select priority"}
                      </span>
                    </SelectTrigger>
                    <SelectPopup>
                      {field.allowedValues.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              );
            }
            if (field.id === "assignee") {
              return (
                <div className="grid gap-1.5" key={field.id}>
                  <span className="text-xs font-medium text-foreground">{field.name}</span>
                  <AssigneePicker
                    environmentId={props.environmentId}
                    settings={props.settings}
                    issueIdOrKey={props.issue.key}
                    selectedUser={draft.assigneeUser}
                    required
                    disabled={props.isSaving}
                    isSaving={false}
                    onSelect={(accountId, user) =>
                      setDraft((current) => ({
                        ...current,
                        assigneeAccountId: accountId,
                        assigneeUser: user,
                      }))
                    }
                  />
                </div>
              );
            }
            return null;
          })}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={props.isSaving} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!props.transition) return;
              const fields: {
                resolutionId?: string;
                assigneeAccountId?: string | null;
                priorityId?: string;
              } = {};
              for (const field of requiredFields) {
                if (field.id === "resolution") fields.resolutionId = draft.resolutionId;
                if (field.id === "assignee") fields.assigneeAccountId = draft.assigneeAccountId;
                if (field.id === "priority") fields.priorityId = draft.priorityId;
              }
              props.onSubmit(props.transition, fields);
            }}
          >
            {props.isSaving ? <LoaderIcon className="size-4 animate-spin" /> : null}
            Apply transition
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function JiraIssueFields(props: {
  readonly environmentId: EnvironmentId | null;
  readonly settings: ServerSettings;
  readonly issue: JiraIssueSummary | JiraIssueDetail;
  readonly detail: JiraIssueDetail | null;
  readonly updatedLabel: string;
  readonly onIssueChanged: () => void;
  readonly onIssueListChanged: () => void;
}) {
  const editMetadataQuery = useEnvironmentQuery(
    props.environmentId
      ? jiraEnvironment.getIssueEditMetadata({
          environmentId: props.environmentId,
          input: { issueIdOrKey: props.issue.key },
        })
      : null,
  );
  const transitionsQuery = useEnvironmentQuery(
    props.environmentId
      ? jiraEnvironment.listIssueTransitions({
          environmentId: props.environmentId,
          input: { issueIdOrKey: props.issue.key },
        })
      : null,
  );
  const assignIssue = useAtomCommand(jiraEnvironment.assignIssue, { reportFailure: false });
  const updateIssueFields = useAtomCommand(jiraEnvironment.updateIssueFields, {
    reportFailure: false,
  });
  const transitionIssue = useAtomCommand(jiraEnvironment.transitionIssue, {
    reportFailure: false,
  });
  const [savingField, setSavingField] = useState<SavingField | null>(null);
  const [pendingTransition, setPendingTransition] = useState<JiraIssueTransition | null>(null);

  const refreshAfterMutation = useCallback(() => {
    refreshJiraIssueMutationQueries([
      props.onIssueChanged,
      props.onIssueListChanged,
      editMetadataQuery.refresh,
      transitionsQuery.refresh,
    ]);
  }, [
    editMetadataQuery.refresh,
    props.onIssueChanged,
    props.onIssueListChanged,
    transitionsQuery.refresh,
  ]);

  const mutateAssignee = useCallback(
    async (accountId: string | null) => {
      if (!props.environmentId || savingField !== null) return;
      if (accountId === (props.issue.assignee?.accountId ?? null)) return;
      setSavingField("assignee");
      const result = await assignIssue({
        environmentId: props.environmentId,
        input: { issueIdOrKey: props.issue.key, accountId },
      });
      setSavingField(null);
      if (result._tag === "Success") {
        refreshAfterMutation();
        return;
      }
      errorToast(
        "Could not update assignee",
        squashAtomCommandFailure(result),
        "Jira rejected the assignee update.",
      );
    },
    [assignIssue, props.environmentId, props.issue, refreshAfterMutation, savingField],
  );

  const mutatePriority = useCallback(
    async (priorityId: string | null) => {
      if (!props.environmentId || savingField !== null) return;
      setSavingField("priority");
      const result = await updateIssueFields({
        environmentId: props.environmentId,
        input: { issueIdOrKey: props.issue.key, priorityId },
      });
      setSavingField(null);
      if (result._tag === "Success") {
        refreshAfterMutation();
        return;
      }
      errorToast(
        "Could not update priority",
        squashAtomCommandFailure(result),
        "Jira rejected the priority update.",
      );
    },
    [props.environmentId, props.issue.key, refreshAfterMutation, savingField, updateIssueFields],
  );

  const mutateTransition = useCallback(
    async (
      transition: JiraIssueTransition,
      fields?: {
        readonly resolutionId?: string;
        readonly assigneeAccountId?: string | null;
        readonly priorityId?: string;
      },
    ) => {
      if (!props.environmentId || savingField !== null) return;
      setSavingField("status");
      const result = await transitionIssue({
        environmentId: props.environmentId,
        input: {
          issueIdOrKey: props.issue.key,
          transitionId: transition.id,
          ...(fields ? { fields } : {}),
        },
      });
      setSavingField(null);
      if (result._tag === "Success") {
        setPendingTransition(null);
        refreshAfterMutation();
        return;
      }
      errorToast(
        "Could not update status",
        squashAtomCommandFailure(result),
        "Jira rejected the transition.",
      );
    },
    [props.environmentId, props.issue.key, refreshAfterMutation, savingField, transitionIssue],
  );

  const metadata = editMetadataQuery.data;
  const assigneeEditable = metadata?.assignee.editable === true;
  const assigneeRequired = metadata?.assignee.required === true;

  return (
    <>
      <dl>
        <DetailRow label="Status">
          <StatusField
            issue={props.issue}
            transitions={transitionsQuery.data?.transitions ?? []}
            isPending={transitionsQuery.isPending}
            isSaving={savingField === "status"}
            onApply={(transition) => void mutateTransition(transition)}
            onOpenDialog={setPendingTransition}
          />
        </DetailRow>
        <DetailRow label="Assignee">
          {assigneeEditable ? (
            <AssigneePicker
              environmentId={props.environmentId}
              settings={props.settings}
              issueIdOrKey={props.issue.key}
              selectedUser={props.issue.assignee}
              required={assigneeRequired}
              disabled={savingField === "assignee"}
              isSaving={savingField === "assignee"}
              onSelect={(accountId) => void mutateAssignee(accountId)}
            />
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <ReadOnlyValue value={props.issue.assignee?.displayName ?? null} />
              {editMetadataQuery.isPending ? (
                <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
              ) : null}
            </span>
          )}
        </DetailRow>
        <DetailRow label="Reporter">
          <ReadOnlyValue value={props.detail?.reporter?.displayName ?? null} />
        </DetailRow>
        <DetailRow label="Priority">
          <PriorityField
            issue={props.issue}
            metadata={metadata}
            isPending={editMetadataQuery.isPending}
            isSaving={savingField === "priority"}
            onChange={(priorityId) => void mutatePriority(priorityId)}
          />
        </DetailRow>
        <DetailRow label="Type">
          <ReadOnlyValue value={props.issue.type} />
        </DetailRow>
        <DetailRow label="Project">
          <ReadOnlyValue value={props.issue.project} />
        </DetailRow>
        <DetailRow label="Updated">
          <ReadOnlyValue value={props.updatedLabel} fallback="" />
        </DetailRow>
      </dl>
      <TransitionDialog
        environmentId={props.environmentId}
        settings={props.settings}
        issue={props.issue}
        transition={pendingTransition}
        isSaving={savingField === "status"}
        onClose={() => setPendingTransition(null)}
        onSubmit={(transition, fields) => void mutateTransition(transition, fields)}
      />
    </>
  );
}

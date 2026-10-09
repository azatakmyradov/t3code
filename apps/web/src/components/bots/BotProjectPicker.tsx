import { LegendList } from "@legendapp/list/react";
import type { BotPermissions } from "@t3tools/contracts";
import {
  BOT_PROJECT_SELECTION_LIMIT,
  botProjectKey,
  botProjectOptions,
  filterBotProjectOptions,
  selectAllBotProjects,
  toggleBotProject,
} from "@t3tools/client-runtime/state/bots";
import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { useEnvironmentIdentities } from "../../state/environments";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useBotProjects } from "./useBotProjects";

/** Trigger plus searchable dialog for the projects a bot may use, across environments. */
export function BotProjectPicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: BotPermissions["projects"];
  onChange: (value: BotPermissions["projects"]) => void;
}) {
  const projects = useBotProjects();
  const environments = useEnvironmentIdentities();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const options = useMemo(
    () => botProjectOptions(projects, environments, value),
    [projects, environments, value],
  );
  const selected = useMemo(() => new Set(value.map(botProjectKey)), [value]);
  const filtered = useMemo(
    () => filterBotProjectOptions(options, selected, query, selectedOnly),
    [options, selected, query, selectedOnly],
  );
  const available = options.filter((option) => option.available);
  const availableKeys = new Set(available.map((option) => option.key));
  const allSelected = available.length > 0 && available.every((option) => selected.has(option.key));
  const selectionSize = new Set([...selected, ...availableKeys]).size;
  const atLimit = value.length >= BOT_PROJECT_SELECTION_LIMIT;
  const groupCount = filtered.filter(
    (item, index) =>
      index === 0 || filtered[index - 1]?.access.environmentId !== item.access.environmentId,
  ).length;
  const listHeight = Math.min(320, Math.max(128, filtered.length * 52 + groupCount * 28));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setSelectedOnly(false);
        }
      }}
    >
      <DialogTrigger id={id} render={<Button variant="outline" />}>
        <FolderIcon />
        <span className="min-w-0 flex-1 text-left">
          {value.length === 0
            ? "Choose projects"
            : `${value.length} ${value.length === 1 ? "project" : "projects"} selected`}
        </span>
        <ChevronDownIcon />
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
          <DialogDescription>Choose the projects this bot can access.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 px-6 pb-4">
          <Input
            aria-label="Search projects"
            placeholder="Search projects or environments…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <Label>
              <Checkbox checked={selectedOnly} onCheckedChange={setSelectedOnly} />
              Selected only
            </Label>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {value.length} selected
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <Label>
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && available.some((option) => selected.has(option.key))}
                disabled={
                  available.length === 0 ||
                  (!allSelected && selectionSize > BOT_PROJECT_SELECTION_LIMIT)
                }
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? selectAllBotProjects(value, options)
                      : value.filter((access) => !availableKeys.has(botProjectKey(access))),
                  )
                }
              />
              All projects
            </Label>
            <Button
              variant="ghost-muted"
              size="sm"
              disabled={value.length === 0}
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
          </div>
          {atLimit || selectionSize > BOT_PROJECT_SELECTION_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              Choose up to {BOT_PROJECT_SELECTION_LIMIT} projects.
            </p>
          ) : null}
          <div
            className="min-h-0"
            style={{ height: listHeight }}
            role="region"
            aria-label="Project choices"
          >
            <LegendList
              key={`${query}:${selectedOnly}`}
              data={filtered}
              extraData={value}
              keyExtractor={(item) => item.key}
              estimatedItemSize={64}
              className="h-full overflow-x-hidden overscroll-y-contain"
              ListEmptyComponent={
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {query
                    ? "No matching projects."
                    : selectedOnly
                      ? "No projects selected."
                      : "No projects available."}
                </p>
              }
              renderItem={({ item, index }) => {
                const checked = selected.has(item.key);
                const disabled = !checked && (atLimit || !item.available);
                const startsEnvironment =
                  index === 0 ||
                  filtered[index - 1]?.access.environmentId !== item.access.environmentId;
                return (
                  <div>
                    {startsEnvironment ? (
                      <div className="pb-2 pt-3 text-xs font-medium text-muted-foreground">
                        {item.environmentLabel}
                      </div>
                    ) : null}
                    <label
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent",
                        disabled && "opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={() => onChange(toggleBotProject(value, item.access))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.available
                            ? item.path
                            : "Not currently available. Deselect to remove access."}
                        </span>
                      </span>
                    </label>
                  </div>
                );
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

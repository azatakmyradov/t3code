import type { ChatSnippet } from "@t3tools/contracts/settings";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useCommitOnBlur } from "../../hooks/useCommitOnBlur";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { InputGroup, InputGroupAddon, InputGroupText } from "../ui/input-group";
import { Textarea, type TextareaProps } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const SNIPPET_KEYWORD_PATTERN = /^[a-z0-9_-]+$/;

type SnippetDraftRow = {
  readonly id: string;
  readonly persistedIndex: number | null;
  readonly keyword: string;
  readonly value: string;
  readonly error: string | null;
};

type SnippetValidationResult =
  | { readonly ok: true; readonly snippet: ChatSnippet }
  | { readonly ok: false; readonly message: string };

type PersistedDraftOverride = {
  readonly keyword: string;
  readonly value: string;
  readonly error: string | null;
};

type DraftTextareaProps = Omit<TextareaProps, "value" | "onChange" | "defaultValue"> & {
  readonly value: string;
  readonly onCommit: (next: string) => void;
};

function normalizeSnippetKeyword(value: string): string {
  return value.trim().replace(/^:/, "").toLowerCase();
}

function persistedSnippetRowId(snippet: ChatSnippet, index: number): string {
  return `persisted:${index}:${snippet.keyword}`;
}

function createPersistedDraftRows(
  snippets: ReadonlyArray<ChatSnippet>,
  overrides: Readonly<Record<string, PersistedDraftOverride>>,
): SnippetDraftRow[] {
  return snippets.map((snippet, index) => {
    const id = persistedSnippetRowId(snippet, index);
    const override = overrides[id];
    return {
      id,
      persistedIndex: index,
      keyword: override?.keyword ?? snippet.keyword,
      value: override?.value ?? snippet.value,
      error: override?.error ?? null,
    };
  });
}

function DraftTextarea({ value, onCommit, onKeyDown, ...rest }: DraftTextareaProps) {
  const bag = useCommitOnBlur<HTMLTextAreaElement>(value, onCommit, { commitOnEnter: false });

  return (
    <Textarea
      {...rest}
      {...bag}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        onKeyDown?.(event);
      }}
    />
  );
}

function validateSnippetDraft(input: {
  readonly keyword: string;
  readonly value: string;
}): SnippetValidationResult {
  const keyword = normalizeSnippetKeyword(input.keyword);
  const value = input.value.trim();
  if (!keyword) {
    return { ok: false, message: "Keyword is required." };
  }
  if (!SNIPPET_KEYWORD_PATTERN.test(keyword)) {
    return { ok: false, message: "Use letters, numbers, dashes, and underscores." };
  }
  if (!value) {
    return { ok: false, message: "Value is required." };
  }
  return { ok: true, snippet: { keyword, value } };
}

function hasDuplicateSnippetKeyword(snippets: ReadonlyArray<ChatSnippet>): boolean {
  const seen = new Set<string>();
  for (const snippet of snippets) {
    const keyword = normalizeSnippetKeyword(snippet.keyword);
    if (seen.has(keyword)) {
      return true;
    }
    seen.add(keyword);
  }
  return false;
}

function omitRecordKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...next } = record;
  return next;
}

export function SnippetsSettingsPanel() {
  const snippets = useSettings((settings) => settings.snippets);
  const { updateSettings } = useUpdateSettings();
  const [draftOnlyRows, setDraftOnlyRows] = useState<SnippetDraftRow[]>([]);
  const [persistedOverrides, setPersistedOverrides] = useState<
    Record<string, PersistedDraftOverride>
  >({});
  const persistedRows = useMemo(
    () => createPersistedDraftRows(snippets, persistedOverrides),
    [persistedOverrides, snippets],
  );
  const draftRows = useMemo(
    () => [...persistedRows, ...draftOnlyRows],
    [draftOnlyRows, persistedRows],
  );

  const updateDraftRow = useCallback(
    (row: SnippetDraftRow, nextRow: Pick<SnippetDraftRow, "keyword" | "value" | "error">) => {
      if (row.persistedIndex === null) {
        setDraftOnlyRows((rows) =>
          rows.map((candidate) =>
            candidate.id === row.id ? { ...candidate, ...nextRow } : candidate,
          ),
        );
        return;
      }
      setPersistedOverrides((overrides) => ({ ...overrides, [row.id]: nextRow }));
    },
    [],
  );

  const deleteSnippet = useCallback(
    (row: SnippetDraftRow) => {
      if (row.persistedIndex === null) {
        setDraftOnlyRows((rows) => rows.filter((candidate) => candidate.id !== row.id));
        return;
      }
      setPersistedOverrides((overrides) => omitRecordKey(overrides, row.id));
      updateSettings({
        snippets: snippets.filter((_, index) => index !== row.persistedIndex),
      });
    },
    [snippets, updateSettings],
  );

  const addSnippet = useCallback(() => {
    const id = `draft:${randomUUID()}`;
    setDraftOnlyRows((rows) => [
      ...rows,
      {
        id,
        persistedIndex: null,
        keyword: "",
        value: "",
        error: null,
      },
    ]);
  }, []);

  const commitRow = useCallback(
    (row: SnippetDraftRow, patch: Partial<Pick<SnippetDraftRow, "keyword" | "value">>) => {
      const nextDraft = {
        keyword: patch.keyword ?? row.keyword,
        value: patch.value ?? row.value,
      };
      const validation = validateSnippetDraft(nextDraft);
      if (!validation.ok) {
        updateDraftRow(row, {
          keyword: normalizeSnippetKeyword(nextDraft.keyword),
          value: nextDraft.value.trim(),
          error: validation.message,
        });
        return;
      }

      const nextSnippets =
        row.persistedIndex === null
          ? [...snippets, validation.snippet]
          : snippets.map((snippet, index) =>
              index === row.persistedIndex ? validation.snippet : snippet,
            );

      if (hasDuplicateSnippetKeyword(nextSnippets)) {
        updateDraftRow(row, {
          keyword: validation.snippet.keyword,
          value: validation.snippet.value,
          error: "Keyword already exists.",
        });
        return;
      }

      updateSettings({ snippets: nextSnippets });
      if (row.persistedIndex === null) {
        setDraftOnlyRows((rows) => rows.filter((candidate) => candidate.id !== row.id));
      } else {
        setPersistedOverrides((overrides) => omitRecordKey(overrides, row.id));
      }
    },
    [snippets, updateDraftRow, updateSettings],
  );

  const headerAction = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Add snippet"
            className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
            onClick={addSnippet}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top">Add snippet</TooltipPopup>
    </Tooltip>
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Snippets" headerAction={headerAction}>
        {draftRows.length === 0 ? (
          <SettingsRow
            title="No snippets"
            description="Create reusable prompt text and insert it from the composer with :keyword."
            control={
              <Button size="sm" variant="outline" onClick={addSnippet}>
                <PlusIcon className="size-3.5" />
                Add snippet
              </Button>
            }
          />
        ) : (
          draftRows.map((row) => (
            <SnippetSettingsRow
              key={row.id}
              row={row}
              onCommitKeyword={(keyword) => commitRow(row, { keyword })}
              onCommitValue={(value) => commitRow(row, { value })}
              onDelete={() => deleteSnippet(row)}
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function SnippetSettingsRow(props: {
  readonly row: SnippetDraftRow;
  readonly onCommitKeyword: (keyword: string) => void;
  readonly onCommitValue: (value: string) => void;
  readonly onDelete: () => void;
}) {
  const keywordInputId = `snippet-keyword-${props.row.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const valueTextareaId = `snippet-value-${props.row.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const description = props.row.keyword
    ? `Inserted when you type :${props.row.keyword} in the composer.`
    : "Type :keyword in the composer to insert this value.";

  return (
    <SettingsRow
      title={props.row.keyword ? `:${props.row.keyword}` : "New snippet"}
      description={description}
      status={props.row.error ? <span className="text-destructive">{props.row.error}</span> : null}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Delete ${props.row.keyword ? `:${props.row.keyword}` : "snippet"}`}
                className="size-7 rounded-sm text-muted-foreground hover:text-destructive"
                onClick={props.onDelete}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="top">Delete snippet</TooltipPopup>
        </Tooltip>
      }
    >
      <div className="grid items-start gap-3 pt-3 pb-4 sm:grid-cols-[minmax(9rem,0.42fr)_minmax(0,1fr)]">
        <label htmlFor={keywordInputId} className="grid content-start gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Keyword</span>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>:</InputGroupText>
            </InputGroupAddon>
            <DraftInput
              nativeInput
              unstyled
              id={keywordInputId}
              value={props.row.keyword}
              autoFocus={
                props.row.persistedIndex === null && !props.row.keyword && !props.row.value
              }
              aria-invalid={props.row.error ? true : undefined}
              aria-label="Snippet keyword"
              placeholder="bug"
              onCommit={props.onCommitKeyword}
            />
          </InputGroup>
        </label>
        <label htmlFor={valueTextareaId} className="grid content-start gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Value</span>
          <DraftTextarea
            id={valueTextareaId}
            size="sm"
            value={props.row.value}
            style={{ maxHeight: "16rem" }}
            aria-invalid={props.row.error ? true : undefined}
            aria-label="Snippet value"
            placeholder="Paste the prompt text to insert"
            onCommit={props.onCommitValue}
          />
        </label>
      </div>
    </SettingsRow>
  );
}

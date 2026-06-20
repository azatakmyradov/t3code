import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo } from "react";

import { DiffStatLabel, hasNonZeroStat } from "~/components/chat/DiffStatLabel";
import { cn } from "~/lib/utils";

import {
  reviewGroupRiskAccentClassName,
  reviewGroupRiskBadgeClassName,
  reviewGroupRiskLabel,
  type ReviewDiffGroupView,
} from "./reviewDiffGroupsModel";
import { reviewDiffStatusLabel, reviewDiffStatusToneClassName } from "./reviewDiffModel";

interface ReviewDiffGroupsSidebarProps {
  readonly groups: ReadonlyArray<ReviewDiffGroupView>;
  readonly selectedPath: string | null;
  readonly reviewedPaths: ReadonlySet<string>;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly onToggleGroup: (id: string) => void;
  readonly onSelectFile: (path: string) => void;
}

function GroupNote({ label, text }: { readonly label: string; readonly text: string }) {
  if (!text.trim()) return null;
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      <span className="font-semibold text-foreground/70">{label}: </span>
      {text}
    </p>
  );
}

function ReviewDiffGroupCard({
  group,
  collapsed,
  selectedPath,
  reviewedPaths,
  onToggleGroup,
  onSelectFile,
}: {
  readonly group: ReviewDiffGroupView;
  readonly collapsed: boolean;
  readonly selectedPath: string | null;
  readonly reviewedPaths: ReadonlySet<string>;
  readonly onToggleGroup: (id: string) => void;
  readonly onSelectFile: (path: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card/40">
      <button
        type="button"
        aria-expanded={!collapsed}
        className="flex w-full items-start gap-2 px-2 py-2 text-left transition-colors hover:bg-accent/30"
        onClick={() => onToggleGroup(group.id)}
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 h-4 w-1 shrink-0 rounded-full",
            reviewGroupRiskAccentClassName(group.riskLevel),
          )}
        />
        {collapsed ? (
          <ChevronRightIcon
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
              {group.title}
            </span>
            {!group.isFallback && (
              <span
                className={cn(
                  "shrink-0 rounded border px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide tabular-nums",
                  reviewGroupRiskBadgeClassName(group.riskLevel),
                )}
                title={group.riskReason || undefined}
              >
                {reviewGroupRiskLabel(group.riskLevel)} · {group.risk}
              </span>
            )}
          </span>
          <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="tabular-nums">
              {group.files.length} {group.files.length === 1 ? "file" : "files"}
            </span>
            {hasNonZeroStat(group.stat) && (
              <DiffStatLabel
                additions={group.stat.additions}
                deletions={group.stat.deletions}
                layout="inline"
              />
            )}
          </span>
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2">
          {group.description.trim() && (
            <p className="text-[11px] leading-relaxed text-foreground/80">{group.description}</p>
          )}
          <GroupNote label="What changed" text={group.whatChanged} />
          <GroupNote label="Review" text={group.reviewFocus} />

          <div className="-mx-1 pt-0.5">
            {group.files.map((file) => {
              const isSelected = file.path === selectedPath;
              const isReviewed = reviewedPaths.has(file.path);
              return (
                <button
                  key={file.renderKey}
                  type="button"
                  aria-selected={isSelected}
                  data-review-diff-tree-path={file.path}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/80 hover:bg-accent/40 hover:text-foreground",
                  )}
                  onClick={() => onSelectFile(file.path)}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isReviewed && "text-muted-foreground/60 line-through",
                    )}
                    title={file.path}
                  >
                    {file.path.split("/").at(-1) ?? file.path}
                  </span>
                  {isReviewed && <CheckIcon className="size-3 shrink-0 text-success" aria-hidden />}
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] tabular-nums",
                      reviewDiffStatusToneClassName(file.status),
                    )}
                    aria-label={`status ${file.status}`}
                  >
                    {reviewDiffStatusLabel(file.status)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export const ReviewDiffGroupsSidebar = memo(function ReviewDiffGroupsSidebar({
  groups,
  selectedPath,
  reviewedPaths,
  collapsedGroups,
  onToggleGroup,
  onSelectFile,
}: ReviewDiffGroupsSidebarProps) {
  return (
    <div className="flex flex-col gap-2 p-2">
      {groups.map((group) => (
        <ReviewDiffGroupCard
          key={group.id}
          group={group}
          collapsed={collapsedGroups.has(group.id)}
          selectedPath={selectedPath}
          reviewedPaths={reviewedPaths}
          onToggleGroup={onToggleGroup}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
});

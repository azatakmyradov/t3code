import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import {
  reviewDiffStatusLabel,
  reviewDiffStatusToneClassName,
  type ReviewDiffTreeNode,
} from "./reviewDiffModel";

interface ReviewDiffFileTreeProps {
  readonly nodes: ReadonlyArray<ReviewDiffTreeNode>;
  readonly selectedPath: string | null;
  readonly collapsedDirectories: ReadonlySet<string>;
  readonly reviewedPaths: ReadonlySet<string>;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleDirectory: (path: string) => void;
}

const INDENT_STEP_PX = 12;
const ROW_BASE_PADDING_PX = 8;

function ReviewDiffTreeRows({
  nodes,
  depth,
  selectedPath,
  collapsedDirectories,
  reviewedPaths,
  onSelectFile,
  onToggleDirectory,
}: ReviewDiffFileTreeProps & { readonly depth: number }) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "directory") {
          const collapsed = collapsedDirectories.has(node.path);
          return (
            <div key={`dir:${node.path}`}>
              <button
                type="button"
                role="treeitem"
                aria-expanded={!collapsed}
                className="flex w-full items-center gap-1 py-1 pr-2 text-left text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                style={{ paddingInlineStart: `${depth * INDENT_STEP_PX + ROW_BASE_PADDING_PX}px` }}
                onClick={() => onToggleDirectory(node.path)}
              >
                {collapsed ? (
                  <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate font-medium">{node.name}</span>
              </button>
              {!collapsed && (
                <div role="group">
                  <ReviewDiffTreeRows
                    nodes={node.children}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    collapsedDirectories={collapsedDirectories}
                    reviewedPaths={reviewedPaths}
                    onSelectFile={onSelectFile}
                    onToggleDirectory={onToggleDirectory}
                  />
                </div>
              )}
            </div>
          );
        }

        const isSelected = node.path === selectedPath;
        const isReviewed = reviewedPaths.has(node.path);
        return (
          <button
            key={`file:${node.path}`}
            type="button"
            role="treeitem"
            aria-selected={isSelected}
            data-review-diff-tree-path={node.path}
            className={cn(
              "flex w-full items-center gap-2 py-1 pr-2 text-left transition-colors",
              isSelected
                ? "bg-accent text-accent-foreground"
                : "text-foreground/80 hover:bg-accent/40 hover:text-foreground",
            )}
            style={{
              paddingInlineStart: `${depth * INDENT_STEP_PX + ROW_BASE_PADDING_PX + 14}px`,
            }}
            onClick={() => onSelectFile(node.path)}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                isReviewed && "text-muted-foreground/60 line-through",
              )}
              title={node.path}
            >
              {node.name}
            </span>
            {isReviewed && <CheckIcon className="size-3 shrink-0 text-success" aria-hidden />}
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] tabular-nums",
                reviewDiffStatusToneClassName(node.file.status),
              )}
              aria-label={`status ${node.file.status}`}
            >
              {reviewDiffStatusLabel(node.file.status)}
            </span>
          </button>
        );
      })}
    </>
  );
}

export const ReviewDiffFileTree = memo(function ReviewDiffFileTree(props: ReviewDiffFileTreeProps) {
  return (
    <div role="tree" className="py-1 text-xs">
      <ReviewDiffTreeRows {...props} depth={0} />
    </div>
  );
});

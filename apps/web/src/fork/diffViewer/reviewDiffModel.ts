import type { ChangeTypes, FileDiffMetadata } from "@pierre/diffs";

import {
  buildFileDiffRenderKey,
  resolveFileDiffPath,
  stripDiffPathPrefix,
} from "~/lib/diffRendering";

/**
 * Fork-local model for the full-screen working-tree diff viewer.
 *
 * These helpers are intentionally pure and decoupled from the base app's
 * turn/checkpoint diff panel so the fork feature can evolve (and be merged)
 * independently. They translate the parsed `FileDiffMetadata` produced by
 * `getRenderablePatch` into a sortable file list and a nested directory tree.
 */

export type ReviewDiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export interface ReviewDiffStat {
  readonly additions: number;
  readonly deletions: number;
}

export interface ReviewDiffFile {
  readonly path: string;
  readonly prevPath: string | null;
  readonly status: ReviewDiffFileStatus;
  readonly stat: ReviewDiffStat;
  readonly renderKey: string;
  readonly fileDiff: FileDiffMetadata;
}

export type ReviewDiffTreeNode = ReviewDiffTreeDirectoryNode | ReviewDiffTreeFileNode;

export interface ReviewDiffTreeDirectoryNode {
  readonly kind: "directory";
  readonly name: string;
  readonly path: string;
  readonly children: ReadonlyArray<ReviewDiffTreeNode>;
}

export interface ReviewDiffTreeFileNode {
  readonly kind: "file";
  readonly name: string;
  readonly path: string;
  readonly file: ReviewDiffFile;
}

const SORT_LOCALE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, undefined, SORT_LOCALE_OPTIONS);
}

export function resolveReviewDiffStatus(type: ChangeTypes): ReviewDiffFileStatus {
  switch (type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
    default:
      return "modified";
  }
}

export function reviewDiffStatusLabel(status: ReviewDiffFileStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "modified":
    default:
      return "M";
  }
}

export function reviewDiffStatusToneClassName(status: ReviewDiffFileStatus): string {
  switch (status) {
    case "added":
      return "text-success";
    case "deleted":
      return "text-destructive";
    case "renamed":
      return "text-primary";
    case "modified":
    default:
      return "text-muted-foreground";
  }
}

/** Count additions/deletions for a single file from its parsed hunks. */
export function countReviewDiffStat(fileDiff: FileDiffMetadata): ReviewDiffStat {
  let additions = 0;
  let deletions = 0;
  for (const hunk of fileDiff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "change") {
        additions += content.additions;
        deletions += content.deletions;
      }
    }
  }
  return { additions, deletions };
}

/** Map parsed file diffs to a stable, path-sorted review file list. */
export function buildReviewDiffFiles(files: ReadonlyArray<FileDiffMetadata>): ReviewDiffFile[] {
  return files
    .map((fileDiff): ReviewDiffFile => {
      const path = resolveFileDiffPath(fileDiff);
      const prevName = fileDiff.prevName ? stripDiffPathPrefix(fileDiff.prevName) : null;
      return {
        path,
        prevPath: prevName && prevName !== path ? prevName : null,
        status: resolveReviewDiffStatus(fileDiff.type),
        stat: countReviewDiffStat(fileDiff),
        renderKey: buildFileDiffRenderKey(fileDiff),
        fileDiff,
      };
    })
    .filter((file) => file.path.length > 0)
    .toSorted((left, right) => comparePaths(left.path, right.path));
}

export function summarizeReviewDiffStat(files: ReadonlyArray<ReviewDiffFile>): ReviewDiffStat {
  return files.reduce<ReviewDiffStat>(
    (acc, file) => ({
      additions: acc.additions + file.stat.additions,
      deletions: acc.deletions + file.stat.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

interface MutableDirectoryNode {
  readonly name: string;
  readonly path: string;
  readonly directories: Map<string, MutableDirectoryNode>;
  readonly files: ReviewDiffFile[];
}

function toTreeNodes(directory: MutableDirectoryNode): ReviewDiffTreeNode[] {
  const directories = Array.from(directory.directories.values())
    .toSorted((left, right) => comparePaths(left.name, right.name))
    .map<ReviewDiffTreeNode>((child) => ({
      kind: "directory",
      name: child.name,
      path: child.path,
      children: toTreeNodes(child),
    }));

  const files = directory.files
    .toSorted((left, right) => comparePaths(left.path, right.path))
    .map<ReviewDiffTreeNode>((file) => ({
      kind: "file",
      name: file.path.split("/").at(-1) ?? file.path,
      path: file.path,
      file,
    }));

  return [...directories, ...files];
}

/** Build a nested directory tree (directories first, then files) for the sidebar. */
export function buildReviewDiffTree(files: ReadonlyArray<ReviewDiffFile>): ReviewDiffTreeNode[] {
  const root: MutableDirectoryNode = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const segments = file.path.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      continue;
    }

    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const nextPath = directory.path ? `${directory.path}/${segment}` : segment;
      const existing = directory.directories.get(segment);
      if (existing) {
        directory = existing;
      } else {
        const created: MutableDirectoryNode = {
          name: segment,
          path: nextPath,
          directories: new Map(),
          files: [],
        };
        directory.directories.set(segment, created);
        directory = created;
      }
    }
    directory.files.push(file);
  }

  return toTreeNodes(root);
}

/**
 * Flatten the tree into the file list in the exact top-to-bottom order the
 * sidebar shows (directories first at each level, then files), so the diff pane
 * order matches the sidebar.
 */
export function flattenReviewDiffTreeFiles(
  nodes: ReadonlyArray<ReviewDiffTreeNode>,
): ReviewDiffFile[] {
  const result: ReviewDiffFile[] = [];
  for (const node of nodes) {
    if (node.kind === "directory") {
      result.push(...flattenReviewDiffTreeFiles(node.children));
    } else {
      result.push(node.file);
    }
  }
  return result;
}

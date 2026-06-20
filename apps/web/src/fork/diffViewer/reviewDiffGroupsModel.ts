import type {
  ReviewGroupsDefaultMode,
  ReviewSemanticGroup,
  ReviewSemanticGroupRiskLevel,
} from "@t3tools/contracts";

import { stripDiffPathPrefix } from "~/lib/diffRendering";

import {
  summarizeReviewDiffStat,
  type ReviewDiffFile,
  type ReviewDiffStat,
} from "./reviewDiffModel";

/**
 * Reconciliation between the server's AI semantic groups (which reference files
 * by path) and the locally-parsed `ReviewDiffFile` list (the authoritative set
 * of changed files). The model can omit, duplicate, or slightly misformat paths,
 * so we resolve each group's paths against the parsed files, assign every file
 * to at most one group, and collect anything the model left out into a synthetic
 * "Other changes" group.
 */

/** Synthetic group id for files the model did not assign to any concern. */
export const OTHER_GROUP_ID = "__ungrouped__";

export interface ReviewDiffGroupView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly whatChanged: string;
  readonly reviewFocus: string;
  readonly risk: number;
  readonly riskLevel: ReviewSemanticGroupRiskLevel;
  readonly riskReason: string;
  readonly files: ReadonlyArray<ReviewDiffFile>;
  readonly stat: ReviewDiffStat;
  /** True for the synthetic "Other changes" group. */
  readonly isFallback: boolean;
}

export type ReviewDiffSidebarMode = "files" | "groups";

export function resolveReviewDiffSidebarMode({
  overrideMode,
  hasGroups,
  defaultMode,
}: {
  readonly overrideMode: ReviewDiffSidebarMode | null;
  readonly hasGroups: boolean;
  readonly defaultMode: ReviewGroupsDefaultMode;
}): ReviewDiffSidebarMode {
  if (!hasGroups) return "files";
  return overrideMode ?? defaultMode;
}

/**
 * Map each group's file paths to the parsed `ReviewDiffFile`s, dropping unknown
 * paths and files already claimed by an earlier (higher-risk) group, then append
 * an "Other changes" group for any leftover changed files. Groups that resolve to
 * zero files are dropped. Input `groups` are assumed already risk-sorted.
 */
export function buildReviewDiffGroupViews(
  groups: ReadonlyArray<ReviewSemanticGroup>,
  files: ReadonlyArray<ReviewDiffFile>,
): ReviewDiffGroupView[] {
  // `file.path` is already prefix-stripped (see resolveFileDiffPath), so we key
  // on it directly and normalize the lookup key below to match.
  const byPath = new Map<string, ReviewDiffFile>();
  for (const file of files) {
    byPath.set(file.path, file);
  }

  // Track assignment by the unique renderKey, not path: a malformed/concatenated
  // patch can yield two files with the same path, and keying on path would let
  // one claim mask the other (or duplicate it in "Other changes").
  const assigned = new Set<string>();
  const views: ReviewDiffGroupView[] = [];

  for (const group of groups) {
    const groupFiles: ReviewDiffFile[] = [];
    for (const rawPath of group.files) {
      const file = byPath.get(stripDiffPathPrefix(rawPath));
      if (!file || assigned.has(file.renderKey)) continue;
      assigned.add(file.renderKey);
      groupFiles.push(file);
    }
    if (groupFiles.length === 0) continue;
    views.push({
      ...group,
      files: groupFiles,
      stat: summarizeReviewDiffStat(groupFiles),
      isFallback: false,
    });
  }

  const leftover = files.filter((file) => !assigned.has(file.renderKey));
  if (leftover.length > 0) {
    views.push({
      id: OTHER_GROUP_ID,
      title: "Other changes",
      description: "Files the AI grouping did not assign to a specific concern.",
      whatChanged: "",
      reviewFocus: "",
      risk: 0,
      riskLevel: "low",
      riskReason: "",
      files: leftover,
      stat: summarizeReviewDiffStat(leftover),
      isFallback: true,
    });
  }

  return views;
}

interface RiskLevelStyle {
  /** Short human label. */
  readonly label: string;
  /** Badge classes (background/text/border). */
  readonly badgeClassName: string;
  /** Accent bar / dot colour. */
  readonly accentClassName: string;
}

const RISK_LEVEL_STYLES: Record<ReviewSemanticGroupRiskLevel, RiskLevelStyle> = {
  critical: {
    label: "Critical",
    badgeClassName: "border-destructive/40 bg-destructive/15 text-destructive",
    accentClassName: "bg-destructive",
  },
  high: {
    label: "High",
    badgeClassName: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    accentClassName: "bg-amber-500",
  },
  medium: {
    label: "Medium",
    badgeClassName: "border-primary/40 bg-primary/10 text-primary",
    accentClassName: "bg-primary",
  },
  low: {
    label: "Low",
    badgeClassName: "border-border/60 bg-muted/50 text-muted-foreground",
    accentClassName: "bg-muted-foreground/50",
  },
};

export function reviewGroupRiskLabel(level: ReviewSemanticGroupRiskLevel): string {
  return RISK_LEVEL_STYLES[level].label;
}

/** Badge classes (background/text/border) for a risk level. */
export function reviewGroupRiskBadgeClassName(level: ReviewSemanticGroupRiskLevel): string {
  return RISK_LEVEL_STYLES[level].badgeClassName;
}

/** Accent bar / dot colour for a risk level. */
export function reviewGroupRiskAccentClassName(level: ReviewSemanticGroupRiskLevel): string {
  return RISK_LEVEL_STYLES[level].accentClassName;
}

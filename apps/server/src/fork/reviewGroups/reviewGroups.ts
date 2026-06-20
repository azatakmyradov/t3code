/**
 * Pure normalization for AI semantic diff groups.
 *
 * Turns the raw, model-produced groups into the contract shape: a clamped 0-100
 * integer risk, a derived risk level, cleaned/deduped file paths, dropped empty
 * groups, and a stable id — sorted most-critical first so the reviewer sees the
 * riskiest changes at the top.
 */
import type { ReviewSemanticGroup, ReviewSemanticGroupRiskLevel } from "@t3tools/contracts";

import type { SemanticDiffGroup } from "./textGeneration.ts";

const RISK_CRITICAL = 75;
const RISK_HIGH = 50;
const RISK_MEDIUM = 25;

/** Bucket a 0-100 score into the colour-coded level used by the UI. */
export function deriveRiskLevel(risk: number): ReviewSemanticGroupRiskLevel {
  if (risk >= RISK_CRITICAL) return "critical";
  if (risk >= RISK_HIGH) return "high";
  if (risk >= RISK_MEDIUM) return "medium";
  return "low";
}

/** Clamp/round an arbitrary model number to a 0-100 integer. */
export function clampRisk(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanFiles(files: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const file of files) {
    const trimmed = file.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Normalize raw model groups into the risk-sorted contract shape. Groups with no
 * usable files are dropped (the client backfills any uncovered changed files
 * into a separate "Other changes" group from the authoritative parsed diff).
 */
export function normalizeSemanticGroups(
  rawGroups: ReadonlyArray<SemanticDiffGroup>,
): ReviewSemanticGroup[] {
  return rawGroups
    .map((group) => {
      const risk = clampRisk(group.risk);
      return {
        title: group.title.trim() || "Untitled changes",
        description: group.description.trim(),
        whatChanged: group.whatChanged.trim(),
        reviewFocus: group.reviewFocus.trim(),
        risk,
        riskLevel: deriveRiskLevel(risk),
        riskReason: group.riskReason.trim(),
        files: cleanFiles(group.files),
      };
    })
    .filter((group) => group.files.length > 0)
    .toSorted((left, right) => right.risk - left.risk)
    .map((group, index) => ({ id: `g${index + 1}`, ...group }));
}

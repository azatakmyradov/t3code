import type { ReviewDiffPreviewSourceKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { TextGenerationPolicy } from "../../textGeneration/TextGenerationPolicy.ts";
import { limitSection } from "../../textGeneration/TextGenerationUtils.ts";

function policyInstruction(instruction: string | undefined): ReadonlyArray<string> {
  const trimmed = instruction?.trim();
  return trimmed ? ["", "Additional instructions:", limitSection(trimmed, 4_000)] : [];
}

export interface SemanticDiffGroupsPromptInput {
  /** Scope of the diff the viewer is showing; the agent reproduces it itself. */
  kind: ReviewDiffPreviewSourceKind;
  baseRef: string;
  headRef: string | null;
  policy?: TextGenerationPolicy | undefined;
}

export function buildSemanticDiffGroupsPrompt(input: SemanticDiffGroupsPromptInput) {
  // The diff is no longer pasted into the prompt. The agent has tools and runs
  // git itself so it can review arbitrarily large diffs. The commands below
  // reproduce the exact diff the review viewer renders for the selected source.
  const gatherSection =
    input.kind === "working-tree"
      ? [
          "This is the WORKING-TREE diff (uncommitted changes). Gather it with your own tools:",
          "- Run: git status --porcelain=v1",
          "- Run: git diff HEAD",
          "- For any untracked files listed by status, read them directly to see their full contents.",
        ]
      : [
          `This is the BRANCH-RANGE diff against '${input.baseRef}'. Gather it with your own tools:`,
          `- Run: git diff ${input.baseRef}...HEAD --stat`,
          `- Run: git diff ${input.baseRef}...HEAD`,
        ];

  const prompt = [
    "You are a senior code reviewer. Cluster a git diff into semantically-related",
    "groups of changes so a reviewer can review the most critical changes first.",
    "",
    "You have tools available (running shell commands, reading files). You MUST",
    "inspect the real diff yourself before answering - do not ask for permission",
    "and do not fabricate changes.",
    ...gatherSection,
    "",
    "Return a JSON object with key: groups (an array).",
    "Each group object must have keys: title, description, whatChanged, reviewFocus, risk, riskReason, files.",
    "Rules:",
    "- Group by concern/feature/behavior (e.g. 'auth token refresh', 'DB migration', 'logging'), NOT by directory.",
    "- Every changed file must appear in exactly one group; do not invent files that are not in the diff.",
    "- Use exact repo-relative file paths exactly as they appear in the diff headers (drop any a/ or b/ prefix).",
    "- title: <= 6 words, specific.",
    "- description: 1-2 sentences on what this set of changes does and why it exists.",
    "- whatChanged: a concrete summary of the actual edits (functions/behavior touched), not a restatement of the title.",
    "- reviewFocus: what a reviewer should scrutinize here: risks, edge cases, things to verify.",
    "- risk: an INTEGER 0-100 for how carefully this group must be reviewed. Weigh blast radius, security/auth/data-loss/migration surface, complexity, and missing tests. Guidance: 0-24 trivial (docs, formatting, comments), 25-49 routine, 50-74 elevated, 75-100 critical.",
    "- riskReason: one short sentence justifying the score.",
    "- Order the groups array from highest risk to lowest.",
    ...policyInstruction(input.policy?.changeRequestInstructions),
  ].join("\n");

  const outputSchema = Schema.Struct({
    groups: Schema.Array(
      Schema.Struct({
        title: Schema.String,
        description: Schema.String,
        whatChanged: Schema.String,
        reviewFocus: Schema.String,
        risk: Schema.Number,
        riskReason: Schema.String,
        files: Schema.Array(Schema.String),
      }),
    ),
  });

  return { prompt, outputSchema };
}

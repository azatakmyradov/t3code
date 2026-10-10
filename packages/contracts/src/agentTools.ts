import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Skills switched off on the environment, by the name agents invoke them
 * with. A name rather than a path: the same skill is reached through several
 * folders (symlinked into each provider's directory, or a worktree's copy of
 * the repo), and a provider only ever sees one of them.
 */
export const DisabledSkills = ForwardCompatibleArray(TrimmedNonEmptyString);
export type DisabledSkills = typeof DisabledSkills.Type;

/**
 * A project's per-skill switches, keyed by skill name. `true` turns a skill
 * off for the project; `false` turns one the environment disabled back on.
 * An absent name inherits.
 */
export const DisabledSkillsProjectOverride = Schema.Record(TrimmedNonEmptyString, Schema.Boolean);
export type DisabledSkillsProjectOverride = typeof DisabledSkillsProjectOverride.Type;

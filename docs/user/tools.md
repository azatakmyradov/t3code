# Skills

**Settings → Tools** controls the skills agents load on an environment. Pick a project in the
settings crumb to change them for that project only. Changes apply when an agent session next starts; use **Restart agent session** in the
command palette to pick them up in an open thread.

The page lists every skill the environment's agents find, grouped by where it lives: the
selected project, your personal folders (such as `~/.agents/skills` and `~/.claude/skills`), and
plugins. A skill is listed once even when several folders or agents have it.

Turning a skill off removes it from the composer's skill menu and hides it from Claude, Codex and
OpenCode 1.x sessions. Cursor, Grok, Antigravity, Pi and OpenCode 2 have no way to hide one skill,
so they may still use it on their own. A skill switched off in the agent's own settings shows as
off and can't be turned on here.

With a project selected, a switch overrides the environment for that project only: you can turn a
skill off for one project, or back on where the environment has it off.

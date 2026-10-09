# Skills and MCP servers

**Settings → Tools** controls what agents can use on an environment: the skills they load and the
MCP servers T3 Code gives them. Pick a project in the settings crumb to change them for that
project only. Changes apply when an agent session next starts; use **Restart agent session** in the
command palette to pick them up in an open thread.

## Skills

The **Skills** tab lists every skill the environment's agents find, grouped by where it lives: the
selected project, your personal folders (such as `~/.agents/skills` and `~/.claude/skills`), and
plugins. A skill is listed once even when several folders or agents have it.

Turning a skill off removes it from the composer's skill menu and hides it from Claude, Codex and
OpenCode 1.x sessions. Cursor, Grok, Antigravity, Pi and OpenCode 2 have no way to hide one skill,
so they may still use it on their own. A skill switched off in the agent's own settings shows as
off and can't be turned on here.

With a project selected, a switch overrides the environment for that project only: you can turn a
skill off for one project, or back on where the environment has it off.

## MCP servers

The **MCP servers** tab lists servers T3 Code adds to every agent session, next to its own
`t3-code` server and the servers each agent already loads from its own config, which keep working
unchanged. T3 Code never edits those config files.

**Add server** takes a command (such as `npx -y @playwright/mcp`) or a URL. Pasting the JSON
snippet from a server's documentation fills in the form. Environment variables and headers are
marked secret by default: secret values are stored on the environment and never shown again, so
leave the field empty to keep one or type a new value to replace it. Adding or editing a server
needs permission to manage providers, because a server runs on the environment for every agent.
Renaming a server or a stored secret, or making a stored secret plain text, requires entering its
value again. When editing across environments, supply replacement credentials if any destination
does not already have its own saved value.

For a URL server that uses OAuth, choose **Browser sign-in**, save it, then **Connect**.
Sign in once for the selected environment. Claude, Codex and OpenCode use that connection, and
T3 refreshes it while agents work. Tokens stay in the environment's protected secret store.
Check its connection status or disconnect in the same row. If an agent started before you connected,
restart its session to retry loading the server. Disconnect removes T3's saved credentials; revoke
access at the provider too if you want to end its authorization grant.

Browser sign-in currently requires a public HTTPS MCP server with OAuth discovery, dynamic public
client registration, and PKCE S256. If the authorization service cannot identify itself on return,
T3 asks you to review its exact issuer, endpoints and requested scopes before opening sign-in.
Only continue if you independently trust that service: this compatibility option cannot prevent a
malicious or compromised service from misdirecting sign-in. The approved endpoints are pinned to
this connection; changed details require another review. Reconnecting asks for trust again.
For remote environments, use an HTTPS address
that your sign-in browser can reach; local loopback addresses work when signing in on the host.
Sign-in is per environment, so select one environment or checkout when editing a bulk scope.

With a project selected, servers you add belong to that project. Giving one the same name as an
environment server replaces it for the project, which is how to point a project at a different
account, including a separate browser sign-in. Inherited servers can be switched off for the project without removing them elsewhere.

Claude, Codex, Cursor, OpenCode, Grok and other ACP agents get these servers. ACP agents that don't
support URL servers only get command servers. Pi isn't supported yet.

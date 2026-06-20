import type { ThreadId } from "@t3tools/contracts";

/**
 * Tracks which threads have referenced a Jira ticket and may therefore use the
 * Jira MCP tools (`jira_get_issue` / `jira_list_comments`).
 *
 * The Jira tools are always registered on the shared MCP server, but a thread
 * should only be able to call them once the user has actually mentioned a ticket
 * — otherwise the agent has no ticket to read and the tools are noise. The MCP
 * framework lists tools per connection and its visibility hook cannot see our
 * per-thread invocation scope, so we cannot remove the tools from the listing;
 * instead the handlers consult this registry and fail closed for threads that
 * have not referenced a ticket.
 *
 * State is sticky for the life of a provider session: once a thread references a
 * ticket the access persists across follow-up turns (so "now list its comments"
 * keeps working), and is cleared when the thread's MCP session is torn down.
 */
const threadsWithJiraReference = new Set<ThreadId>();

export function markThreadJiraReferenced(threadId: ThreadId): void {
  threadsWithJiraReference.add(threadId);
}

export function isThreadJiraReferenced(threadId: ThreadId): boolean {
  return threadsWithJiraReference.has(threadId);
}

export function clearThreadJiraReference(threadId: ThreadId): void {
  threadsWithJiraReference.delete(threadId);
}

export function clearAllJiraToolAccess(): void {
  threadsWithJiraReference.clear();
}

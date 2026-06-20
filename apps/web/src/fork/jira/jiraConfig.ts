import type { ServerSettings } from "@t3tools/contracts";

export function normalizeJiraSiteUrl(input: string): string {
  const trimmed = input.trim();
  const url = new URL(trimmed);

  if (url.protocol !== "https:") {
    throw new Error("Jira site URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Jira site URL must be an HTTPS origin without credentials, query, or hash.");
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (url.pathname && url.pathname !== "/") {
    throw new Error("Jira site URL must be the site origin.");
  }

  return url.origin;
}

export function isJiraConfigured(settings: ServerSettings): boolean {
  const jira = settings.fork.jira;
  return (
    jira.siteUrl.trim().length > 0 &&
    jira.email.trim().length > 0 &&
    (jira.apiToken.trim().length > 0 || jira.apiTokenRedacted === true)
  );
}

export function jiraIssueUrl(siteUrl: string, key: string): string {
  return `${normalizeJiraSiteUrl(siteUrl)}/browse/${encodeURIComponent(key)}`;
}

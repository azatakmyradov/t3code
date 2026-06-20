import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isJiraConfigured, jiraIssueUrl, normalizeJiraSiteUrl } from "./jiraConfig";

describe("jiraConfig", () => {
  it("normalizes Jira Cloud site URLs to HTTPS origins", () => {
    expect(normalizeJiraSiteUrl(" https://example.atlassian.net/ ")).toBe(
      "https://example.atlassian.net",
    );
  });

  it("rejects invalid Jira site URLs", () => {
    expect(() => normalizeJiraSiteUrl("http://example.atlassian.net")).toThrow(/HTTPS/);
    expect(() => normalizeJiraSiteUrl("https://user@example.atlassian.net")).toThrow(
      /without credentials/,
    );
    expect(() => normalizeJiraSiteUrl("https://example.atlassian.net/path")).toThrow(/origin/);
    expect(() => normalizeJiraSiteUrl("https://example.atlassian.net?x=1")).toThrow(
      /without credentials/,
    );
  });

  it("detects configured Jira settings with either a materialized or redacted token", () => {
    expect(isJiraConfigured(DEFAULT_SERVER_SETTINGS)).toBe(false);

    expect(
      isJiraConfigured({
        ...DEFAULT_SERVER_SETTINGS,
        fork: {
          ...DEFAULT_SERVER_SETTINGS.fork,
          jira: {
            ...DEFAULT_SERVER_SETTINGS.fork.jira,
            siteUrl: "https://example.atlassian.net",
            email: "ada@example.com",
            apiToken: "token",
          },
        },
      }),
    ).toBe(true);

    expect(
      isJiraConfigured({
        ...DEFAULT_SERVER_SETTINGS,
        fork: {
          ...DEFAULT_SERVER_SETTINGS.fork,
          jira: {
            ...DEFAULT_SERVER_SETTINGS.fork.jira,
            siteUrl: "https://example.atlassian.net",
            email: "ada@example.com",
            apiToken: "",
            apiTokenRedacted: true,
          },
        },
      }),
    ).toBe(true);
  });

  it("builds browse URLs from normalized site URLs", () => {
    expect(jiraIssueUrl("https://example.atlassian.net/", "ABC-123")).toBe(
      "https://example.atlassian.net/browse/ABC-123",
    );
  });
});

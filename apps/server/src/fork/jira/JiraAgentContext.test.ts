import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { ServerSettingsService } from "../../serverSettings.ts";
import { buildJiraAgentContextForMessage } from "./JiraAgentContext.ts";

const fetchedAt = "2026-01-02T03:04:05.000Z";

function makeLayer(input?: { readonly jiraConfigured?: boolean }) {
  const settings =
    input?.jiraConfigured === false
      ? DEFAULT_SERVER_SETTINGS
      : {
          fork: {
            jira: {
              siteUrl: "https://example.atlassian.net",
              email: "ada@example.com",
              apiToken: "jira-token",
            },
          },
        };

  return ServerSettingsService.layerTest(settings);
}

describe("buildJiraAgentContextForMessage", () => {
  effectIt.effect("lists referenced tickets and instructs the agent to use the Jira tools", () =>
    Effect.gen(function* () {
      const result = yield* buildJiraAgentContextForMessage({
        messageText: "Please inspect ABC-123.",
        fetchedAt,
      }).pipe(Effect.provide(makeLayer()));

      expect(result.keys).toEqual(["ABC-123"]);
      expect(result.failedKeys).toEqual([]);
      expect(result.omittedKeys).toEqual([]);
      expect(result.hasLookupFailure).toBe(false);
      expect(result.providerMessageText).toContain("<jira_context>");
      expect(result.providerMessageText).toContain("jira_get_issue");
      expect(result.providerMessageText).toContain("jira_list_comments");
      expect(result.providerMessageText).toContain("- ABC-123");
      expect(result.providerMessageText).toContain("User message:\nPlease inspect ABC-123.");
    }),
  );

  effectIt.effect("includes the browse URL when the reference came from a Jira link", () =>
    Effect.gen(function* () {
      const result = yield* buildJiraAgentContextForMessage({
        messageText: "See https://example.atlassian.net/browse/ABC-123 for details.",
        fetchedAt,
      }).pipe(Effect.provide(makeLayer()));

      expect(result.keys).toEqual(["ABC-123"]);
      expect(result.providerMessageText).toContain(
        "- ABC-123 — https://example.atlassian.net/browse/ABC-123",
      );
    }),
  );

  effectIt.effect("omits tickets beyond the per-turn reference limit", () =>
    Effect.gen(function* () {
      const result = yield* buildJiraAgentContextForMessage({
        messageText: "Check ABC-1, ABC-2, ABC-3, ABC-4, ABC-5, and ABC-6.",
        fetchedAt,
      }).pipe(Effect.provide(makeLayer()));

      expect(result.keys).toEqual(["ABC-1", "ABC-2", "ABC-3", "ABC-4", "ABC-5"]);
      expect(result.omittedKeys).toEqual(["ABC-6"]);
      expect(result.providerMessageText).toContain(
        "Ticket ABC-6 omitted because only 5 tickets are referenced per turn.",
      );
    }),
  );

  effectIt.effect("emits failure context for explicit Jira URLs when Jira is not configured", () =>
    Effect.gen(function* () {
      const result = yield* buildJiraAgentContextForMessage({
        messageText: "See https://example.atlassian.net/browse/ABC-123",
        fetchedAt,
      }).pipe(Effect.provide(makeLayer({ jiraConfigured: false })));

      expect(result.keys).toEqual([]);
      expect(result.failedKeys).toEqual(["ABC-123"]);
      expect(result.hasLookupFailure).toBe(true);
      expect(result.providerMessageText).toContain("<jira_context>");
      expect(result.providerMessageText).toContain(
        "Jira lookup failed for ABC-123: Jira is not configured.",
      );
      expect(result.providerMessageText).toContain(
        "User message:\nSee https://example.atlassian.net/browse/ABC-123",
      );
    }),
  );

  effectIt.effect(
    "emits failure context for a Jira URL whose host is not the configured site",
    () =>
      Effect.gen(function* () {
        const result = yield* buildJiraAgentContextForMessage({
          messageText: "See https://other.atlassian.net/browse/ABC-123",
          fetchedAt,
        }).pipe(Effect.provide(makeLayer()));

        expect(result.keys).toEqual([]);
        expect(result.failedKeys).toEqual(["ABC-123"]);
        expect(result.hasLookupFailure).toBe(true);
        expect(result.providerMessageText).toContain("Jira lookup failed for ABC-123:");
        expect(result.providerMessageText).toContain("does not match configured Jira site");
      }),
  );

  effectIt.effect("returns the message unchanged when there are no Jira references", () =>
    Effect.gen(function* () {
      const result = yield* buildJiraAgentContextForMessage({
        messageText: "No ticket reference in this turn.",
        fetchedAt,
      }).pipe(Effect.provide(makeLayer()));

      expect(result.keys).toEqual([]);
      expect(result.failedKeys).toEqual([]);
      expect(result.lookupAttempted).toBe(false);
      expect(result.providerMessageText).toBe("No ticket reference in this turn.");
      expect(result.providerMessageText).not.toContain("<jira_context>");
    }),
  );
});

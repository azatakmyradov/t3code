import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import { Tool } from "effect/unstable/ai";

import { JiraGetIssueTool, JiraListCommentsTool, JiraToolkit } from "./tools.ts";

it("exports provider-compatible top-level object schemas and useful descriptions", () => {
  for (const tool of Object.values(JiraToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    expect(
      Object.keys(schema.properties ?? {}),
      `${tool.name} must accept an issueIdOrKey parameter`,
    ).toContain("issueIdOrKey");
  }
});

it("exposes exactly the two read-only Jira tools", () => {
  expect(Object.keys(JiraToolkit.tools).toSorted()).toEqual([
    "jira_get_issue",
    "jira_list_comments",
  ]);
  expect(JiraListCommentsTool.name).toBe("jira_list_comments");
  expect(JiraGetIssueTool.name).toBe("jira_get_issue");
});

it("annotates both tools as read-only, non-destructive, and idempotent", () => {
  for (const tool of [JiraListCommentsTool, JiraGetIssueTool]) {
    expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true);
    expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false);
    expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true);
    expect(Context.getOption(tool.annotations, Tool.Title).pipe(Option.isSome)).toBe(true);
  }
});

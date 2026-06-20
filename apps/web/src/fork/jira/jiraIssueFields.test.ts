import { describe, expect, it, vi } from "vite-plus/test";
import type { JiraIssueTransition } from "@t3tools/contracts";

import {
  buildAssignableUsersQueryInput,
  canApplyTransitionImmediately,
  classifyJiraTransitionAction,
  getRequiredSupportedTransitionFields,
  refreshJiraIssueMutationQueries,
  transitionHasUnsupportedRequiredFields,
  transitionRequiresDialog,
} from "./jiraIssueFields";

function transition(fields: JiraIssueTransition["fields"]): JiraIssueTransition {
  return {
    id: "31",
    name: "Resolve",
    to: { id: "10001", name: "Done", category: "done" },
    hasScreen: fields.length > 0,
    fields,
    unsupportedRequiredFieldIds: fields
      .filter((field) => field.required && !field.supported)
      .map((field) => field.id),
  };
}

describe("jiraIssueFields", () => {
  it("classifies immediate, dialog, and unsupported transitions", () => {
    const immediate = transition([]);
    expect(canApplyTransitionImmediately(immediate)).toBe(true);
    expect(transitionRequiresDialog(immediate)).toBe(false);
    expect(classifyJiraTransitionAction(immediate)).toBe("apply");

    const withResolution = transition([
      {
        id: "resolution",
        name: "Resolution",
        required: true,
        supported: true,
        schemaType: "resolution",
        allowedValues: [{ id: "10000", name: "Done" }],
      },
    ]);
    expect(canApplyTransitionImmediately(withResolution)).toBe(false);
    expect(transitionRequiresDialog(withResolution)).toBe(true);
    expect(classifyJiraTransitionAction(withResolution)).toBe("dialog");
    expect(getRequiredSupportedTransitionFields(withResolution).map((field) => field.id)).toEqual([
      "resolution",
    ]);

    const unsupported = transition([
      {
        id: "customfield_10010",
        name: "Linked request",
        required: true,
        supported: false,
        schemaType: "array",
        allowedValues: [],
      },
    ]);
    expect(transitionHasUnsupportedRequiredFields(unsupported)).toBe(true);
    expect(canApplyTransitionImmediately(unsupported)).toBe(false);
    expect(transitionRequiresDialog(unsupported)).toBe(false);
    expect(classifyJiraTransitionAction(unsupported)).toBe("linkOut");
  });

  it("orders supported transition dialog fields with resolution first", () => {
    const fields = getRequiredSupportedTransitionFields(
      transition([
        {
          id: "priority",
          name: "Priority",
          required: true,
          supported: true,
          schemaType: "priority",
          allowedValues: [{ id: "2", name: "High" }],
        },
        {
          id: "resolution",
          name: "Resolution",
          required: true,
          supported: true,
          schemaType: "resolution",
          allowedValues: [{ id: "1", name: "Fixed" }],
        },
      ]),
    );
    expect(fields.map((field) => field.id)).toEqual(["resolution", "priority"]);
  });

  it("normalizes assignable-user search input without rejecting empty queries", () => {
    expect(
      buildAssignableUsersQueryInput({
        issueIdOrKey: " ABC-123 ",
        query: "  ada  ",
        maxResults: 10,
      }),
    ).toEqual({ issueIdOrKey: "ABC-123", query: "ada", maxResults: 10 });
    expect(
      buildAssignableUsersQueryInput({
        issueIdOrKey: "ABC-123",
        query: "   ",
        maxResults: 10,
      }),
    ).toEqual({ issueIdOrKey: "ABC-123", query: "", maxResults: 10 });
  });

  it("refreshes all mutation-dependent queries after success", () => {
    const refreshIssue = vi.fn();
    const refreshList = vi.fn();
    const refreshMetadata = vi.fn();
    const refreshTransitions = vi.fn();
    refreshJiraIssueMutationQueries([
      refreshIssue,
      refreshList,
      refreshMetadata,
      refreshTransitions,
      null,
      undefined,
    ]);
    expect(refreshIssue).toHaveBeenCalledTimes(1);
    expect(refreshList).toHaveBeenCalledTimes(1);
    expect(refreshMetadata).toHaveBeenCalledTimes(1);
    expect(refreshTransitions).toHaveBeenCalledTimes(1);
  });
});

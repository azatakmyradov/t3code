import type {
  JiraIssueTransition,
  JiraIssueTransitionField,
  JiraSearchAssignableUsersInput,
} from "@t3tools/contracts";

const TRANSITION_FIELD_ORDER = new Map([
  ["resolution", 0],
  ["assignee", 1],
  ["priority", 2],
]);

export type JiraTransitionAction = "apply" | "dialog" | "linkOut";

export function getRequiredSupportedTransitionFields(
  transition: JiraIssueTransition,
): ReadonlyArray<JiraIssueTransitionField> {
  return transition.fields
    .filter((field) => field.required && field.supported)
    .toSorted(
      (left, right) =>
        (TRANSITION_FIELD_ORDER.get(left.id) ?? 99) - (TRANSITION_FIELD_ORDER.get(right.id) ?? 99),
    );
}

export function transitionHasUnsupportedRequiredFields(transition: JiraIssueTransition): boolean {
  return transition.unsupportedRequiredFieldIds.length > 0;
}

export function transitionRequiresDialog(transition: JiraIssueTransition): boolean {
  return (
    !transitionHasUnsupportedRequiredFields(transition) &&
    getRequiredSupportedTransitionFields(transition).length > 0
  );
}

export function canApplyTransitionImmediately(transition: JiraIssueTransition): boolean {
  return (
    !transitionHasUnsupportedRequiredFields(transition) &&
    getRequiredSupportedTransitionFields(transition).length === 0
  );
}

export function classifyJiraTransitionAction(
  transition: JiraIssueTransition,
): JiraTransitionAction {
  if (transitionHasUnsupportedRequiredFields(transition)) return "linkOut";
  if (transitionRequiresDialog(transition)) return "dialog";
  return "apply";
}

export function buildAssignableUsersQueryInput(input: {
  readonly issueIdOrKey: string;
  readonly query: string;
  readonly maxResults: number;
}): JiraSearchAssignableUsersInput {
  return {
    issueIdOrKey: input.issueIdOrKey.trim(),
    query: input.query.trim(),
    maxResults: input.maxResults,
  };
}

export function refreshJiraIssueMutationQueries(
  callbacks: ReadonlyArray<(() => void) | null | undefined>,
): void {
  for (const callback of callbacks) {
    callback?.();
  }
}

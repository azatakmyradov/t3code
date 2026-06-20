export const JIRA_REFERENCE_MAX_ISSUES = 5;

const JIRA_ISSUE_KEY_PATTERN = "[A-Z][A-Z0-9]{1,31}-[1-9][0-9]*";
const NAKED_JIRA_ISSUE_KEY_REGEX = new RegExp(`\\b${JIRA_ISSUE_KEY_PATTERN}\\b`, "g");
const URL_REGEX = /https?:\/\/[^\s<>()\]]+/giu;
const MARKDOWN_LINK_REGEX = /\[[^\]]*?\]\([^)]+?\)/gu;

export interface JiraTicketReference {
  readonly key: string;
  readonly url?: string;
}

export type JiraReferenceFailureReason = "not_configured" | "site_mismatch";

export interface JiraReferenceFailure {
  readonly key: string;
  readonly url: string;
  readonly reason: JiraReferenceFailureReason;
  readonly message: string;
}

export interface ParseJiraReferencesInput {
  readonly text: string;
  readonly configuredSiteUrl: string | null;
  readonly jiraConfigured: boolean;
  readonly maxIssues?: number;
}

export interface ParseJiraReferencesResult {
  readonly references: ReadonlyArray<JiraTicketReference>;
  readonly failures: ReadonlyArray<JiraReferenceFailure>;
  readonly omittedKeys: ReadonlyArray<string>;
}

interface JiraReferenceCandidate {
  readonly key: string;
  readonly url?: string;
  readonly index: number;
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

function trimUrlCandidate(value: string): string {
  return value.replace(/[.,;:!?]+$/u, "");
}

function getUrlOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLikelyJiraHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "atlassian.net" || normalized.endsWith(".atlassian.net");
}

function issueKeyFromBrowseUrl(url: URL): string | null {
  const match = /\/browse\/([^/?#]+)/iu.exec(url.pathname);
  if (!match?.[1]) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    decoded = match[1];
  }

  const normalized = normalizeKey(decoded);
  return new RegExp(`^${JIRA_ISSUE_KEY_PATTERN}$`, "u").test(normalized) ? normalized : null;
}

function lineEnd(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline + 1;
}

function startsAtLineStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === "\n";
}

function collectFencedCodeRanges(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let index = 0;

  while (index < text.length) {
    if (!startsAtLineStart(text, index)) {
      index += 1;
      continue;
    }

    const fenceChar = text[index];
    if (fenceChar !== "`" && fenceChar !== "~") {
      index = lineEnd(text, index);
      continue;
    }

    let fenceLength = 0;
    while (text[index + fenceLength] === fenceChar) {
      fenceLength += 1;
    }
    if (fenceLength < 3) {
      index = lineEnd(text, index);
      continue;
    }

    const start = index;
    index = lineEnd(text, index);
    let end = text.length;
    while (index < text.length) {
      if (startsAtLineStart(text, index)) {
        let closingLength = 0;
        while (text[index + closingLength] === fenceChar) {
          closingLength += 1;
        }
        if (closingLength >= fenceLength) {
          end = lineEnd(text, index);
          break;
        }
      }
      index = lineEnd(text, index);
    }
    ranges.push([start, end]);
    index = end;
  }

  return ranges;
}

function isInsideRanges(index: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function collectInlineCodeRanges(
  text: string,
  fencedRanges: ReadonlyArray<readonly [number, number]>,
): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let index = 0;

  while (index < text.length) {
    if (isInsideRanges(index, fencedRanges) || text[index] !== "`") {
      index += 1;
      continue;
    }

    let tickCount = 0;
    while (text[index + tickCount] === "`") {
      tickCount += 1;
    }

    const fence = "`".repeat(tickCount);
    const end = text.indexOf(fence, index + tickCount);
    if (end === -1) {
      index += tickCount;
      continue;
    }
    ranges.push([index, end + tickCount]);
    index = end + tickCount;
  }

  return ranges;
}

function collectMarkdownLinkRanges(text: string): Array<readonly [number, number]> {
  return [...text.matchAll(MARKDOWN_LINK_REGEX)].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length,
  ]);
}

function collectUrlRanges(text: string): Array<readonly [number, number]> {
  return [...text.matchAll(URL_REGEX)].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + trimUrlCandidate(match[0]).length,
  ]);
}

function maskRanges(text: string, ranges: ReadonlyArray<readonly [number, number]>): string {
  if (ranges.length === 0) return text;
  const chars = text.split("");
  for (const [start, end] of ranges) {
    for (let index = start; index < end && index < chars.length; index += 1) {
      if (chars[index] !== "\n") {
        chars[index] = " ";
      }
    }
  }
  return chars.join("");
}

function collectUrlCandidates(input: {
  readonly text: string;
  readonly configuredOrigin: string | null;
  readonly jiraConfigured: boolean;
}): {
  readonly candidates: ReadonlyArray<JiraReferenceCandidate>;
  readonly failures: ReadonlyArray<JiraReferenceFailure>;
} {
  const candidates: JiraReferenceCandidate[] = [];
  const failures: JiraReferenceFailure[] = [];
  const seenFailures = new Set<string>();

  for (const match of input.text.matchAll(URL_REGEX)) {
    const raw = trimUrlCandidate(match[0]);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }

    const key = issueKeyFromBrowseUrl(url);
    if (!key) continue;

    const urlOrigin = url.origin;
    if (input.configuredOrigin !== null && urlOrigin === input.configuredOrigin) {
      candidates.push({ key, url: raw, index: match.index ?? 0 });
      continue;
    }

    if (!isLikelyJiraHost(url.hostname)) {
      continue;
    }

    const failureKey = `${key}\0${raw}`;
    if (seenFailures.has(failureKey)) {
      continue;
    }
    seenFailures.add(failureKey);
    failures.push({
      key,
      url: raw,
      reason: input.jiraConfigured ? "site_mismatch" : "not_configured",
      message:
        input.configuredOrigin === null
          ? "Jira is not configured."
          : `Jira URL host ${url.hostname} does not match configured Jira site ${
              new URL(input.configuredOrigin).hostname
            }.`,
    });
  }

  return { candidates, failures };
}

function collectNakedKeyCandidates(
  text: string,
  ignoredRanges: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<JiraReferenceCandidate> {
  const searchable = maskRanges(text, ignoredRanges);
  return [...searchable.matchAll(NAKED_JIRA_ISSUE_KEY_REGEX)].map((match) => ({
    key: normalizeKey(match[0]),
    index: match.index ?? 0,
  }));
}

export function parseJiraReferences(input: ParseJiraReferencesInput): ParseJiraReferencesResult {
  const maxIssues = input.maxIssues ?? JIRA_REFERENCE_MAX_ISSUES;
  const configuredOrigin = getUrlOrigin(input.configuredSiteUrl);
  const urlResult = collectUrlCandidates({
    text: input.text,
    configuredOrigin,
    jiraConfigured: input.jiraConfigured && configuredOrigin !== null,
  });

  const candidates: JiraReferenceCandidate[] = [...urlResult.candidates];
  if (input.jiraConfigured && configuredOrigin !== null) {
    const fencedRanges = collectFencedCodeRanges(input.text);
    const inlineRanges = collectInlineCodeRanges(input.text, fencedRanges);
    const markdownLinkRanges = collectMarkdownLinkRanges(input.text);
    const urlRanges = collectUrlRanges(input.text);
    candidates.push(
      ...collectNakedKeyCandidates(input.text, [
        ...fencedRanges,
        ...inlineRanges,
        ...markdownLinkRanges,
        ...urlRanges,
      ]),
    );
  }

  candidates.sort((left, right) => left.index - right.index);

  const references: JiraTicketReference[] = [];
  const omittedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    if (seenKeys.has(candidate.key)) {
      continue;
    }
    seenKeys.add(candidate.key);
    if (references.length < maxIssues) {
      references.push({
        key: candidate.key,
        ...(candidate.url ? { url: candidate.url } : {}),
      });
    } else {
      omittedKeys.push(candidate.key);
    }
  }

  return {
    references,
    failures: urlResult.failures,
    omittedKeys,
  };
}

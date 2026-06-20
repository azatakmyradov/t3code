import type { JiraAdfDocument } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createEmptyJiraAdfDocument,
  extractJiraAdfPlainText,
  hasUnsupportedJiraAdfNodes,
  isEmptyJiraAdfDocument,
  jiraAdfToLexicalInitialState,
  lexicalEditorStateToJiraAdf,
} from "./jiraAdf";

function roundTrip(document: JiraAdfDocument): JiraAdfDocument {
  const state = jiraAdfToLexicalInitialState(document);
  expect(state).not.toBeNull();
  return lexicalEditorStateToJiraAdf(state!);
}

function doc(...content: ReadonlyArray<unknown>): JiraAdfDocument {
  return { type: "doc", version: 1, content };
}

describe("jiraAdf", () => {
  it("detects empty documents", () => {
    expect(isEmptyJiraAdfDocument(createEmptyJiraAdfDocument())).toBe(true);
    expect(isEmptyJiraAdfDocument(doc({ type: "paragraph" }))).toBe(true);
    expect(
      isEmptyJiraAdfDocument(
        doc({ type: "paragraph", content: [{ type: "text", text: "hello" }] }),
      ),
    ).toBe(false);
  });

  it("extracts plain text with hard breaks and nested lists", () => {
    const document = doc(
      { type: "paragraph", content: [{ type: "text", text: "Line one" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before" },
          { type: "hardBreak" },
          { type: "text", text: "after" },
        ],
      },
    );
    expect(extractJiraAdfPlainText(document)).toBe("Line one\nItem\nbefore\nafter");
  });

  it("round trips paragraphs with bold, italic, strike, and code marks", () => {
    const document = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "bold", marks: [{ type: "strong" }] },
        { type: "text", text: "italic", marks: [{ type: "em" }] },
        { type: "text", text: "struck", marks: [{ type: "strike" }] },
        { type: "text", text: "code", marks: [{ type: "code" }] },
        { type: "text", text: "plain" },
      ],
    });
    expect(roundTrip(document)).toEqual(document);
  });

  it("round trips links", () => {
    const document = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "see " },
        {
          type: "text",
          text: "docs",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    });
    expect(roundTrip(document)).toEqual(document);
  });

  it("round trips headings, quotes, and code blocks", () => {
    const document = doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "const x = 1" }],
      },
    );
    expect(roundTrip(document)).toEqual(document);
  });

  it("round trips ordered and bulleted lists", () => {
    const document = doc(
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
          },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }],
          },
        ],
      },
    );
    expect(roundTrip(document)).toEqual(document);
  });

  it("clamps heading levels above three on the way to lexical", () => {
    const state = jiraAdfToLexicalInitialState(
      doc({ type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "deep" }] }),
    );
    expect(state).toContain('"tag":"h3"');
  });

  it("treats media nodes as supported", () => {
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [{ type: "media", attrs: { id: "uuid", type: "file" } }],
        }),
      ),
    ).toBe(false);
  });

  it("round trips user mentions", () => {
    const document = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "ping " },
        { type: "mention", attrs: { id: "acc-1", text: "@Ada Lovelace" } },
        { type: "text", text: " please" },
      ],
    });
    expect(roundTrip(document)).toEqual(document);
  });

  it("round trips issue inline cards", () => {
    const document = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "see " },
        { type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/ABC-123" } },
      ],
    });
    expect(roundTrip(document)).toEqual(document);
  });

  it("treats mentions and inline cards as supported", () => {
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "acc-1", text: "@Ada" } }],
        }),
      ),
    ).toBe(false);
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({
          type: "paragraph",
          content: [
            { type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/ABC-1" } },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("flags mention/inline-card shapes the editor cannot round-trip as unsupported", () => {
    // inlineCard with no URL (e.g. a resolved smart-link carrying attrs.data)
    // would be silently dropped on edit, so it must trip the unsupported guard.
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({
          type: "paragraph",
          content: [{ type: "inlineCard", attrs: { data: { type: "issue" } } }],
        }),
      ),
    ).toBe(true);
    // The editor cannot carry marks on a mention/inline-card token.
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "a", text: "@A" }, marks: [{ type: "strong" }] },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("includes mention and inline-card text when extracting plain text", () => {
    const document = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "ping " },
        { type: "mention", attrs: { id: "acc-1", text: "@Ada" } },
        { type: "text", text: " about " },
        { type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/ABC-123" } },
      ],
    });
    expect(extractJiraAdfPlainText(document)).toBe("ping @Ada about ABC-123");
    expect(isEmptyJiraAdfDocument(document)).toBe(false);
  });

  it("keeps the visible text when a mention has no account id", () => {
    const state = jiraAdfToLexicalInitialState(
      doc({ type: "paragraph", content: [{ type: "mention", attrs: { text: "@Ghost" } }] }),
    );
    expect(state).not.toBeNull();
    expect(lexicalEditorStateToJiraAdf(state!)).toEqual(
      doc({ type: "paragraph", content: [{ type: "text", text: "@Ghost" }] }),
    );
  });

  it("round trips media single nodes", () => {
    const document = doc({
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [{ type: "media", attrs: { id: "uuid-1", type: "file" } }],
    });
    expect(roundTrip(document)).toEqual(document);
  });

  it("detects unsupported nodes", () => {
    expect(hasUnsupportedJiraAdfNodes(doc({ type: "paragraph" }))).toBe(false);
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({
          type: "paragraph",
          content: [{ type: "text", text: "hi", marks: [{ type: "underline" }] }],
        }),
      ),
    ).toBe(true);
    expect(
      hasUnsupportedJiraAdfNodes(
        doc({ type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "x" }] }),
      ),
    ).toBe(true);
  });

  it("returns an empty document for malformed lexical state", () => {
    expect(lexicalEditorStateToJiraAdf("not json")).toEqual(createEmptyJiraAdfDocument());
  });
});

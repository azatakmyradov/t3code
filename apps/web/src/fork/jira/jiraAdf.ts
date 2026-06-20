import type { JiraAdfDocument } from "@t3tools/contracts";

/**
 * Conversion between Atlassian Document Format (ADF) and the Lexical editor's
 * serialized state. This module owns the supported editable subset; the editor
 * and renderer defer to it for all structural mapping.
 *
 * Supported blocks: paragraph, heading (1-3), bulletList, orderedList,
 * listItem, blockquote, codeBlock, mediaSingle/mediaGroup/media. Supported
 * inline: text, hardBreak. Supported marks: strong, em, strike, code, link.
 *
 * https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

/**
 * Lexical node type used for inline media (attachments). The editor registers a
 * matching {@link DecoratorNode}; these conversions only deal with its
 * serialized JSON shape.
 */
export const JIRA_MEDIA_NODE_TYPE = "jira-media";

export type JiraMediaPreview = {
  readonly contentUrl: string;
  readonly thumbnailUrl: string | null;
  readonly filename: string;
  readonly mimeType: string;
};

export type SerializedJiraMediaNode = {
  readonly type: typeof JIRA_MEDIA_NODE_TYPE;
  readonly version: 1;
  readonly mediaAttrs: Record<string, unknown>;
  readonly mediaSingleAttrs: Record<string, unknown>;
  readonly preview: JiraMediaPreview | null;
};

/**
 * Lexical node types for the two inline "mention" affordances: an ADF `mention`
 * (a user) and an ADF `inlineCard` (a link to another issue). Both are modeled
 * as token {@link TextNode}s in the editor; these conversions only deal with the
 * serialized JSON shapes.
 */
export const JIRA_MENTION_NODE_TYPE = "jira-mention";
export const JIRA_INLINE_CARD_NODE_TYPE = "jira-inline-card";

/** Serialized fields shared with Lexical's `TextNode` (the token base). */
type SerializedTokenTextFields = {
  readonly text: string;
  readonly detail: number;
  readonly format: number;
  readonly mode: "normal" | "token" | "segmented";
  readonly style: string;
};

export type SerializedJiraMentionNode = SerializedTokenTextFields & {
  readonly type: typeof JIRA_MENTION_NODE_TYPE;
  readonly version: 1;
  /** Jira account id the mention resolves against. */
  readonly mentionId: string;
};

export type SerializedJiraInlineCardNode = SerializedTokenTextFields & {
  readonly type: typeof JIRA_INLINE_CARD_NODE_TYPE;
  readonly version: 1;
  /** Absolute `/browse/KEY` URL of the referenced issue. */
  readonly url: string;
};

// Lexical text-format bitmask flags (see lexical's TextNode format constants).
const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_STRIKETHROUGH = 4;
const FORMAT_CODE = 16;

const SUPPORTED_BLOCK_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "mediaSingle",
  "mediaGroup",
  "media",
]);
const SUPPORTED_INLINE_TYPES = new Set(["text", "hardBreak", "mention", "inlineCard"]);
const SUPPORTED_MARK_TYPES = new Set(["strong", "em", "strike", "code", "link"]);

/** Recover the issue key from a `/browse/KEY` URL, for inline-card labels. */
export function jiraIssueKeyFromBrowseUrl(url: string): string | null {
  const match = /\/browse\/([^/?#]+)/u.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type AdfNode = {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: unknown;
  readonly marks?: unknown;
  readonly content?: unknown;
};

type LexicalNode = Record<string, unknown> & { type: string; version: number };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function adfContent(node: AdfNode): ReadonlyArray<AdfNode> {
  return asArray(node.content).filter((child): child is AdfNode => asObject(child) !== null);
}

function lexicalChildren(node: Record<string, unknown>): ReadonlyArray<Record<string, unknown>> {
  return asArray(node.children)
    .map(asObject)
    .filter((child): child is Record<string, unknown> => child !== null);
}

// ---------------------------------------------------------------------------
// ADF helpers
// ---------------------------------------------------------------------------

export function createEmptyJiraAdfDocument(): JiraAdfDocument {
  return { type: "doc", version: 1, content: [] };
}

/**
 * Build the serialized media-node fields for a freshly uploaded attachment.
 * Embeds the resolved Media Services UUID (falling back to the REST id) and
 * carries proxy preview URLs so the editor can render it immediately.
 */
export function jiraMediaNodeFromAttachment(attachment: {
  readonly mediaId: string | null;
  readonly restId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly contentUrl: string;
  readonly thumbnailUrl: string | null;
}): Pick<SerializedJiraMediaNode, "mediaAttrs" | "mediaSingleAttrs" | "preview"> {
  return {
    mediaAttrs: { type: "file", id: attachment.mediaId ?? attachment.restId },
    mediaSingleAttrs: { layout: "center" },
    preview: {
      contentUrl: attachment.contentUrl,
      thumbnailUrl: attachment.thumbnailUrl,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    },
  };
}

export function extractJiraAdfPlainText(document: JiraAdfDocument): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    const record = asObject(node);
    if (!record) return;
    if (record.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    if (record.type === "mention") {
      const text = asObject(record.attrs)?.text;
      parts.push(typeof text === "string" && text.length > 0 ? text : "@unknown");
      return;
    }
    if (record.type === "inlineCard") {
      const url = asObject(record.attrs)?.url;
      if (typeof url === "string" && url.length > 0) {
        parts.push(jiraIssueKeyFromBrowseUrl(url) ?? url);
      }
      return;
    }
    if (typeof record.text === "string") {
      parts.push(record.text);
    }
    for (const child of asArray(record.content)) walk(child);
    if (typeof record.type === "string" && record.type !== "text") {
      parts.push("\n");
    }
  };
  try {
    walk(document);
  } catch {
    return "";
  }
  return parts
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

export function isEmptyJiraAdfDocument(document: JiraAdfDocument): boolean {
  return extractJiraAdfPlainText(document).length === 0;
}

/** Whether the document carries any media node (used to allow media-only posts). */
export function jiraAdfContainsMedia(document: JiraAdfDocument): boolean {
  const walk = (node: AdfNode): boolean => {
    const type = typeof node.type === "string" ? node.type : "";
    if (type === "media" || type === "mediaSingle" || type === "mediaGroup") return true;
    return adfContent(node).some(walk);
  };
  return adfContent(document as AdfNode).some(walk);
}

/** Whether the document has any submittable content — text or media. */
export function jiraAdfHasContent(document: JiraAdfDocument): boolean {
  return !isEmptyJiraAdfDocument(document) || jiraAdfContainsMedia(document);
}

export function hasUnsupportedJiraAdfNodes(document: JiraAdfDocument): boolean {
  let unsupported = false;
  const walk = (node: AdfNode): void => {
    if (unsupported) return;
    const type = typeof node.type === "string" ? node.type : null;
    if (type === null) {
      unsupported = true;
      return;
    }
    if (type === "mention" || type === "inlineCard") {
      // The editor models these as plain token nodes: it cannot represent marks
      // on them, and it can only round-trip a URL-based inlineCard (a `data`-only
      // smart link would be dropped). Flag anything else so the user is warned
      // before an edit silently discards it.
      if (asArray(node.marks).length > 0) {
        unsupported = true;
        return;
      }
      if (type === "inlineCard") {
        const url = asObject(node.attrs)?.url;
        if (typeof url !== "string" || url.trim().length === 0) {
          unsupported = true;
        }
      }
      return;
    }
    if (SUPPORTED_INLINE_TYPES.has(type)) {
      for (const mark of asArray(node.marks)) {
        const markType = asObject(mark)?.type;
        if (typeof markType !== "string" || !SUPPORTED_MARK_TYPES.has(markType)) {
          unsupported = true;
          return;
        }
      }
      return;
    }
    if (!SUPPORTED_BLOCK_TYPES.has(type)) {
      unsupported = true;
      return;
    }
    if (type === "heading") {
      const level = asObject(node.attrs)?.level;
      if (typeof level !== "number" || level < 1 || level > 3) {
        unsupported = true;
        return;
      }
    }
    for (const child of adfContent(node)) walk(child);
  };
  walk(document as AdfNode);
  return unsupported;
}

// ---------------------------------------------------------------------------
// ADF -> Lexical serialized state
// ---------------------------------------------------------------------------

function lexicalTextNode(text: string, format: number, url: string | null): LexicalNode {
  const textNode: LexicalNode = {
    type: "text",
    version: 1,
    detail: 0,
    format,
    mode: "normal",
    style: "",
    text,
  };
  if (url === null) return textNode;
  return {
    type: "link",
    version: 1,
    children: [textNode],
    direction: "ltr",
    format: "",
    indent: 0,
    rel: null,
    target: null,
    title: null,
    url,
  };
}

/** Standard serialized fields for a token {@link TextNode} carrying `text`. */
function tokenTextFields(text: string): SerializedTokenTextFields {
  return { text, detail: 0, format: 0, mode: "token", style: "" };
}

/**
 * Convert an ADF `mention` to its Lexical token node. A mention missing its
 * account id cannot round-trip, so its visible text is preserved as plain text
 * instead of an editable mention token.
 *
 * Only `id` and `text` survive an edit; Jira re-derives the rest (`localId`,
 * `accessLevel`) from the account id on save, so dropping them is lossless in
 * practice.
 */
function lexicalMentionFromAdf(node: AdfNode): LexicalNode {
  const attrs = asObject(node.attrs);
  const id = typeof attrs?.id === "string" ? attrs.id.trim() : "";
  const rawText = typeof attrs?.text === "string" ? attrs.text : "";
  const text = rawText.length > 0 ? rawText : `@${id || "unknown"}`;
  if (!id) return lexicalTextNode(text, 0, null);
  return {
    type: JIRA_MENTION_NODE_TYPE,
    version: 1,
    mentionId: id,
    ...tokenTextFields(text),
  } satisfies SerializedJiraMentionNode as unknown as LexicalNode;
}

/** Convert an ADF `inlineCard` to its Lexical token node (null when it has no URL). */
function lexicalInlineCardFromAdf(node: AdfNode): LexicalNode | null {
  const attrs = asObject(node.attrs);
  const url = typeof attrs?.url === "string" ? attrs.url.trim() : "";
  if (!url) return null;
  const label = jiraIssueKeyFromBrowseUrl(url) ?? url;
  return {
    type: JIRA_INLINE_CARD_NODE_TYPE,
    version: 1,
    url,
    ...tokenTextFields(label),
  } satisfies SerializedJiraInlineCardNode as unknown as LexicalNode;
}

function lexicalInlineFromAdf(content: ReadonlyArray<AdfNode>): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  for (const node of content) {
    if (node.type === "hardBreak") {
      nodes.push({ type: "linebreak", version: 1 });
      continue;
    }
    if (node.type === "mention") {
      nodes.push(lexicalMentionFromAdf(node));
      continue;
    }
    if (node.type === "inlineCard") {
      const card = lexicalInlineCardFromAdf(node);
      if (card) nodes.push(card);
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string" || node.text.length === 0) {
      continue;
    }
    let format = 0;
    let url: string | null = null;
    for (const mark of asArray(node.marks)) {
      const markObj = asObject(mark);
      const markType = markObj?.type;
      if (markType === "strong") format |= FORMAT_BOLD;
      else if (markType === "em") format |= FORMAT_ITALIC;
      else if (markType === "strike") format |= FORMAT_STRIKETHROUGH;
      else if (markType === "code") format |= FORMAT_CODE;
      else if (markType === "link") {
        const href = asObject(markObj?.attrs)?.href;
        if (typeof href === "string" && href.length > 0) url = href;
      }
    }
    nodes.push(lexicalTextNode(node.text, format, url));
  }
  return nodes;
}

function elementWrap(type: string, children: LexicalNode[], extra: Record<string, unknown> = {}) {
  return {
    type,
    version: 1,
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    ...extra,
  } satisfies LexicalNode;
}

/** Flatten block content (paragraphs) into inline children separated by line breaks. */
function flattenBlocksToInline(blocks: ReadonlyArray<AdfNode>): LexicalNode[] {
  const inline: LexicalNode[] = [];
  blocks.forEach((block, index) => {
    if (index > 0) inline.push({ type: "linebreak", version: 1 });
    inline.push(...lexicalInlineFromAdf(adfContent(block)));
  });
  return inline;
}

function lexicalListItemFromAdf(item: AdfNode): LexicalNode {
  const children: LexicalNode[] = [];
  const paragraphs: AdfNode[] = [];
  for (const child of adfContent(item)) {
    if (child.type === "bulletList" || child.type === "orderedList") {
      children.push(lexicalListFromAdf(child));
    } else {
      paragraphs.push(child);
    }
  }
  const inline = flattenBlocksToInline(paragraphs);
  return elementWrap("listitem", [...inline, ...children], { value: 1 });
}

function lexicalListFromAdf(list: AdfNode): LexicalNode {
  const ordered = list.type === "orderedList";
  const items = adfContent(list)
    .filter((item) => item.type === "listItem")
    .map(lexicalListItemFromAdf);
  return elementWrap("list", items, {
    listType: ordered ? "number" : "bullet",
    start: 1,
    tag: ordered ? "ol" : "ul",
  });
}

function lexicalBlockFromAdf(node: AdfNode): LexicalNode | null {
  switch (node.type) {
    case "paragraph":
      return elementWrap("paragraph", lexicalInlineFromAdf(adfContent(node)), {
        textFormat: 0,
        textStyle: "",
      });
    case "heading": {
      const rawLevel = asObject(node.attrs)?.level;
      const level =
        typeof rawLevel === "number" ? Math.min(Math.max(Math.trunc(rawLevel), 1), 3) : 1;
      return elementWrap("heading", lexicalInlineFromAdf(adfContent(node)), { tag: `h${level}` });
    }
    case "blockquote":
      return elementWrap("quote", flattenBlocksToInline(adfContent(node)));
    case "codeBlock": {
      const language = asObject(node.attrs)?.language;
      return elementWrap("code", lexicalInlineFromAdf(adfContent(node)), {
        language: typeof language === "string" && language.length > 0 ? language : null,
      });
    }
    case "bulletList":
    case "orderedList":
      return lexicalListFromAdf(node);
    default:
      return null;
  }
}

/**
 * Convert an ADF `mediaSingle`/`mediaGroup` into one serialized media node per
 * `media` child. The standard ADF attrs are preserved verbatim so a media node
 * round-trips losslessly; preview URLs are resolved at render time.
 */
function lexicalMediaFromAdf(node: AdfNode): LexicalNode[] {
  const singleAttrs = node.type === "mediaSingle" ? (asObject(node.attrs) ?? {}) : {};
  return adfContent(node)
    .filter((child) => child.type === "media")
    .map((media) => ({
      type: JIRA_MEDIA_NODE_TYPE,
      version: 1,
      mediaAttrs: asObject(media.attrs) ?? {},
      mediaSingleAttrs: singleAttrs,
      preview: null,
    }));
}

export function jiraAdfToLexicalInitialState(document: JiraAdfDocument): string | null {
  try {
    const blocks = adfContent(document as AdfNode).flatMap((node) => {
      if (node.type === "mediaSingle" || node.type === "mediaGroup") {
        return lexicalMediaFromAdf(node);
      }
      const block = lexicalBlockFromAdf(node);
      return block === null ? [] : [block];
    });
    if (blocks.length === 0) {
      blocks.push(elementWrap("paragraph", [], { textFormat: 0, textStyle: "" }));
    }
    return JSON.stringify({
      root: {
        type: "root",
        version: 1,
        children: blocks,
        direction: "ltr",
        format: "",
        indent: 0,
      },
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lexical serialized state -> ADF
// ---------------------------------------------------------------------------

function adfTextMarks(format: number, url: string | null): ReadonlyArray<Record<string, unknown>> {
  const marks: Record<string, unknown>[] = [];
  if (format & FORMAT_BOLD) marks.push({ type: "strong" });
  if (format & FORMAT_ITALIC) marks.push({ type: "em" });
  if (format & FORMAT_STRIKETHROUGH) marks.push({ type: "strike" });
  if (format & FORMAT_CODE) marks.push({ type: "code" });
  if (url !== null) marks.push({ type: "link", attrs: { href: url } });
  return marks;
}

function adfTextNode(text: string, format: number, url: string | null): Record<string, unknown> {
  const marks = adfTextMarks(format, url);
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function adfInlineFromLexical(
  children: ReadonlyArray<Record<string, unknown>>,
  inheritedUrl: string | null = null,
): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const child of children) {
    if (child.type === "linebreak" || child.type === "tab") {
      nodes.push({ type: "hardBreak" });
      continue;
    }
    if (child.type === JIRA_MENTION_NODE_TYPE) {
      const id = typeof child.mentionId === "string" ? child.mentionId : "";
      const text = typeof child.text === "string" ? child.text : "";
      if (id) nodes.push({ type: "mention", attrs: { id, text } });
      else if (text) nodes.push({ type: "text", text });
      continue;
    }
    if (child.type === JIRA_INLINE_CARD_NODE_TYPE) {
      const url = typeof child.url === "string" ? child.url : "";
      if (url) nodes.push({ type: "inlineCard", attrs: { url } });
      else if (typeof child.text === "string" && child.text.length > 0) {
        nodes.push({ type: "text", text: child.text });
      }
      continue;
    }
    if (child.type === "link") {
      const url = typeof child.url === "string" && child.url.length > 0 ? child.url : null;
      nodes.push(...adfInlineFromLexical(lexicalChildren(child), url));
      continue;
    }
    // text and code-highlight (code block tokens) both carry text + format.
    if (typeof child.text === "string" && child.text.length > 0) {
      const format = typeof child.format === "number" ? child.format : 0;
      nodes.push(adfTextNode(child.text, format, inheritedUrl));
    }
  }
  return nodes;
}

function withContent(
  node: Record<string, unknown>,
  content: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  return content.length > 0 ? { ...node, content } : node;
}

function adfListItemFromLexical(item: Record<string, unknown>): Record<string, unknown> {
  const inline: Record<string, unknown>[] = [];
  const nested: Record<string, unknown>[] = [];
  for (const child of lexicalChildren(item)) {
    if (child.type === "list") {
      nested.push(adfListFromLexical(child));
    } else {
      inline.push(...adfInlineFromLexical([child]));
    }
  }
  const content: Record<string, unknown>[] = [
    withContent({ type: "paragraph" }, inline),
    ...nested,
  ];
  return { type: "listItem", content };
}

function adfListFromLexical(list: Record<string, unknown>): Record<string, unknown> {
  const ordered = list.listType === "number";
  const items = lexicalChildren(list)
    .filter((child) => child.type === "listitem")
    .map(adfListItemFromLexical);
  return { type: ordered ? "orderedList" : "bulletList", content: items };
}

function adfBlockFromLexical(node: Record<string, unknown>): Record<string, unknown> | null {
  switch (node.type) {
    case "paragraph":
      return withContent({ type: "paragraph" }, adfInlineFromLexical(lexicalChildren(node)));
    case "heading": {
      const tag = typeof node.tag === "string" ? node.tag : "h1";
      const parsed = Number.parseInt(tag.replace(/^h/iu, ""), 10);
      const level = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 3) : 1;
      return withContent(
        { type: "heading", attrs: { level } },
        adfInlineFromLexical(lexicalChildren(node)),
      );
    }
    case "quote":
      return {
        type: "blockquote",
        content: [withContent({ type: "paragraph" }, adfInlineFromLexical(lexicalChildren(node)))],
      };
    case "code": {
      const language =
        typeof node.language === "string" && node.language.length > 0 ? node.language : null;
      return withContent(
        { type: "codeBlock", attrs: language === null ? {} : { language } },
        adfInlineFromLexical(lexicalChildren(node)),
      );
    }
    case "list":
      return adfListFromLexical(node);
    case JIRA_MEDIA_NODE_TYPE: {
      const mediaAttrs = asObject(node.mediaAttrs) ?? {};
      const mediaSingleAttrs = asObject(node.mediaSingleAttrs) ?? {};
      const media: Record<string, unknown> = {
        type: "media",
        ...(Object.keys(mediaAttrs).length > 0 ? { attrs: mediaAttrs } : {}),
      };
      return {
        type: "mediaSingle",
        ...(Object.keys(mediaSingleAttrs).length > 0 ? { attrs: mediaSingleAttrs } : {}),
        content: [media],
      };
    }
    default:
      return null;
  }
}

export function lexicalEditorStateToJiraAdf(editorStateJson: string): JiraAdfDocument {
  try {
    const parsed = asObject(JSON.parse(editorStateJson));
    const root = asObject(parsed?.root);
    if (!root) return createEmptyJiraAdfDocument();
    const content = lexicalChildren(root)
      .map(adfBlockFromLexical)
      .filter((node): node is Record<string, unknown> => node !== null);
    return { type: "doc", version: 1, content };
  } catch {
    return createEmptyJiraAdfDocument();
  }
}

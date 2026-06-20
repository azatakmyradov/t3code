import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  PUNCTUATION,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import type {
  EnvironmentId,
  JiraAdfDocument,
  JiraAttachment,
  JiraIssueSummary,
  JiraMediaResolution,
  JiraMentionUser,
  ServerSettings,
} from "@t3tools/contracts";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  createCommand,
  DecoratorNode,
  DROP_COMMAND,
  type EditorConfig,
  type EditorState,
  FORMAT_TEXT_COMMAND,
  type LexicalCommand,
  type NodeKey,
  PASTE_COMMAND,
  TextNode,
} from "lexical";
import {
  BoldIcon,
  CodeIcon,
  FileIcon,
  HeadingIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderIcon,
  type LucideIcon,
  PaperclipIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  type ReactPortal,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "../../components/ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import {
  extractJiraAdfPlainText,
  JIRA_INLINE_CARD_NODE_TYPE,
  JIRA_MEDIA_NODE_TYPE,
  JIRA_MENTION_NODE_TYPE,
  type JiraMediaPreview,
  jiraAdfToLexicalInitialState,
  jiraIssueKeyFromBrowseUrl,
  jiraMediaNodeFromAttachment,
  lexicalEditorStateToJiraAdf,
  type SerializedJiraInlineCardNode,
  type SerializedJiraMediaNode,
  type SerializedJiraMentionNode,
} from "./jiraAdf";
import {
  JIRA_ISSUE_MENTION_DISPLAY_LIMIT,
  JIRA_ISSUE_MENTION_FETCH_LIMIT,
  rankJiraIssues,
} from "./jiraSearch";
import { JIRA_ALL_ISSUES_JQL, useJiraMentionSearch, useJiraUserMentionSearch } from "./jiraState";

// ---------------------------------------------------------------------------
// Shared media rendering
// ---------------------------------------------------------------------------

/** Resolved media metadata shared by the renderer and the editor decorator. */
type ResolvedMedia = {
  readonly contentUrl: string;
  readonly thumbnailUrl: string | null;
  readonly filename: string;
  readonly mimeType: string;
};

export type JiraMediaResolutions = Readonly<Record<string, JiraMediaResolution>>;

const JiraMediaResolutionsContext = createContext<JiraMediaResolutions>({});

function isImageMedia(resolved: ResolvedMedia | null): boolean {
  return resolved !== null && resolved.mimeType.toLowerCase().startsWith("image/");
}

/** Render a single media attachment as an inline image or a downloadable chip. */
function MediaView(props: {
  readonly resolved: ResolvedMedia | null;
  readonly fallbackName: string;
}) {
  const { resolved, fallbackName } = props;
  if (isImageMedia(resolved) && resolved) {
    return (
      <Dialog>
        <DialogTrigger
          aria-label={`Open ${resolved.filename}`}
          className="inline-block max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={resolved.thumbnailUrl ?? resolved.contentUrl}
            alt={resolved.filename}
            className="max-h-64 max-w-full rounded-md border border-border object-contain"
            loading="lazy"
          />
        </DialogTrigger>
        <DialogPopup className="w-auto max-w-[90vw] bg-popover p-2">
          <DialogTitle className="sr-only">{resolved.filename}</DialogTitle>
          <img
            src={resolved.contentUrl}
            alt={resolved.filename}
            className="max-h-[80vh] max-w-full rounded-md object-contain"
          />
        </DialogPopup>
      </Dialog>
    );
  }
  const name = resolved?.filename || fallbackName;
  const className =
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs";
  if (resolved?.contentUrl) {
    return (
      <a href={resolved.contentUrl} target="_blank" rel="noreferrer" className={className}>
        <FileIcon className="size-3.5" />
        {name}
      </a>
    );
  }
  return (
    <span className={cn(className, "text-muted-foreground")}>
      <FileIcon className="size-3.5" />
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Read-only ADF renderer
// ---------------------------------------------------------------------------

type AdfNode = {
  readonly type?: string;
  readonly text?: string;
  readonly attrs?: Record<string, unknown>;
  readonly marks?: ReadonlyArray<{
    readonly type?: string;
    readonly attrs?: Record<string, unknown>;
  }>;
  readonly content?: ReadonlyArray<AdfNode>;
};

/** Shared chip styling for user mentions, used by both the editor and renderer. */
const JIRA_MENTION_CLASS = "rounded-sm bg-primary/10 px-0.5 font-medium text-primary";
/** Shared chip styling for issue (inline-card) references. */
const JIRA_INLINE_CARD_CLASS =
  "rounded-sm bg-muted px-1 font-medium text-primary underline-offset-2 hover:underline";

function renderAdfText(node: AdfNode, key: number): React.ReactNode {
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "mention") {
    const text = node.attrs?.text;
    return (
      <span key={key} className={JIRA_MENTION_CLASS}>
        {typeof text === "string" && text.length > 0 ? text : "@unknown"}
      </span>
    );
  }
  if (node.type === "inlineCard") {
    const url = typeof node.attrs?.url === "string" ? node.attrs.url : null;
    if (url === null) return null;
    const label = jiraIssueKeyFromBrowseUrl(url) ?? url;
    return (
      <a key={key} href={url} target="_blank" rel="noreferrer" className={JIRA_INLINE_CARD_CLASS}>
        {label}
      </a>
    );
  }
  if (typeof node.text !== "string") return null;
  let element: React.ReactNode = node.text;
  let href: string | null = null;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong":
        element = <strong>{element}</strong>;
        break;
      case "em":
        element = <em>{element}</em>;
        break;
      case "strike":
        element = <s>{element}</s>;
        break;
      case "code":
        element = (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{element}</code>
        );
        break;
      case "link": {
        const linkHref = mark.attrs?.href;
        if (typeof linkHref === "string") href = linkHref;
        break;
      }
      default:
        break;
    }
  }
  if (href !== null) {
    element = (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {element}
      </a>
    );
  }
  return <span key={key}>{element}</span>;
}

function renderAdfInline(content: ReadonlyArray<AdfNode> | undefined): React.ReactNode {
  return (content ?? []).map((node, index) => renderAdfText(node, index));
}

function resolveMediaNode(
  node: AdfNode,
  resolutions: JiraMediaResolutions,
): { resolved: ResolvedMedia | null; fallbackName: string } {
  const attrs = node.attrs ?? {};
  const id = typeof attrs.id === "string" ? attrs.id : null;
  const resolved = id ? (resolutions[id] ?? null) : null;
  const fallbackName =
    (typeof attrs.alt === "string" && attrs.alt) ||
    (typeof attrs.id === "string" && attrs.id) ||
    "Attachment";
  return { resolved, fallbackName };
}

function renderAdfBlock(
  node: AdfNode,
  key: number,
  resolutions: JiraMediaResolutions,
): React.ReactNode {
  switch (node.type) {
    case "mediaSingle":
    case "mediaGroup":
      return (
        <div key={key} className="flex flex-wrap gap-2 py-1">
          {(node.content ?? []).map((child, index) => renderAdfBlock(child, index, resolutions))}
        </div>
      );
    case "media": {
      const { resolved, fallbackName } = resolveMediaNode(node, resolutions);
      return <MediaView key={key} resolved={resolved} fallbackName={fallbackName} />;
    }
    case "paragraph":
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {renderAdfInline(node.content)}
        </p>
      );
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      const className = cn(
        "font-semibold",
        level === 1 && "text-base",
        level === 2 && "text-sm",
        level === 3 && "text-sm",
      );
      const children = renderAdfInline(node.content);
      if (level === 1)
        return (
          <h3 key={key} className={className}>
            {children}
          </h3>
        );
      if (level === 2)
        return (
          <h4 key={key} className={className}>
            {children}
          </h4>
        );
      return (
        <h5 key={key} className={className}>
          {children}
        </h5>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">
          {(node.content ?? []).map((child, index) => renderAdfBlock(child, index, resolutions))}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed"
        >
          <code>{extractJiraAdfPlainText({ type: "doc", version: 1, content: [node] })}</code>
        </pre>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {(node.content ?? []).map((item, itemIndex) => (
            <li key={itemIndex}>
              {(item.content ?? []).map((child, i) => renderAdfBlock(child, i, resolutions))}
            </li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {(node.content ?? []).map((item, itemIndex) => (
            <li key={itemIndex}>
              {(item.content ?? []).map((child, i) => renderAdfBlock(child, i, resolutions))}
            </li>
          ))}
        </ol>
      );
    default: {
      // Unknown node: best-effort plain-text fallback so content is never lost.
      const text = extractJiraAdfPlainText({ type: "doc", version: 1, content: [node] });
      return text ? (
        <p key={key} className="whitespace-pre-wrap break-words text-muted-foreground">
          {text}
        </p>
      ) : null;
    }
  }
}

export function JiraAdfRenderer(props: {
  readonly document: JiraAdfDocument;
  readonly mediaResolutions?: JiraMediaResolutions | undefined;
}) {
  const content = props.document.content as ReadonlyArray<AdfNode>;
  const resolutions = props.mediaResolutions ?? {};
  if (content.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No content.</p>;
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground">
      {content.map((node, index) => renderAdfBlock(node, index, resolutions))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const EDITOR_THEME = {
  paragraph: "mb-1 last:mb-0",
  quote: "border-l-2 border-border pl-3 text-muted-foreground",
  heading: {
    h1: "text-base font-semibold",
    h2: "text-sm font-semibold",
    h3: "text-sm font-semibold",
  },
  list: {
    ul: "list-disc pl-5",
    ol: "list-decimal pl-5",
    listitem: "mb-0.5",
  },
  link: "text-primary underline underline-offset-2",
  code: "block overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed",
  text: {
    bold: "font-semibold",
    italic: "italic",
    strikethrough: "line-through",
    code: "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
  },
};

function JiraMediaDecorator(props: {
  readonly mediaId: string | null;
  readonly preview: JiraMediaPreview | null;
  readonly fallbackName: string;
}) {
  const resolutions = useContext(JiraMediaResolutionsContext);
  const resolved: ResolvedMedia | null =
    props.preview ?? (props.mediaId ? (resolutions[props.mediaId] ?? null) : null);
  return (
    <div className="my-1 select-none" contentEditable={false}>
      <MediaView resolved={resolved} fallbackName={props.fallbackName} />
    </div>
  );
}

/**
 * Lexical decorator node for inline Jira media. Carries the verbatim ADF media
 * attrs (so it round-trips losslessly) plus optional proxy preview URLs for
 * freshly uploaded files. Existing media resolve their preview via context.
 */
class JiraMediaNode extends DecoratorNode<ReactNode> {
  readonly __mediaAttrs: Record<string, unknown>;
  readonly __mediaSingleAttrs: Record<string, unknown>;
  readonly __preview: JiraMediaPreview | null;

  constructor(
    mediaAttrs: Record<string, unknown>,
    mediaSingleAttrs: Record<string, unknown>,
    preview: JiraMediaPreview | null,
    key?: NodeKey,
  ) {
    super(key);
    this.__mediaAttrs = mediaAttrs;
    this.__mediaSingleAttrs = mediaSingleAttrs;
    this.__preview = preview;
  }

  static override getType(): string {
    return JIRA_MEDIA_NODE_TYPE;
  }

  static override clone(node: JiraMediaNode): JiraMediaNode {
    return new JiraMediaNode(
      node.__mediaAttrs,
      node.__mediaSingleAttrs,
      node.__preview,
      node.__key,
    );
  }

  static override importJSON(json: SerializedJiraMediaNode): JiraMediaNode {
    return new JiraMediaNode(
      json.mediaAttrs ?? {},
      json.mediaSingleAttrs ?? {},
      json.preview ?? null,
    );
  }

  override exportJSON(): SerializedJiraMediaNode {
    return {
      type: JIRA_MEDIA_NODE_TYPE,
      version: 1,
      mediaAttrs: this.__mediaAttrs,
      mediaSingleAttrs: this.__mediaSingleAttrs,
      preview: this.__preview,
    };
  }

  override createDOM(): HTMLElement {
    return document.createElement("div");
  }

  override updateDOM(): false {
    return false;
  }

  override isInline(): boolean {
    return false;
  }

  override decorate(): ReactNode {
    const mediaId = typeof this.__mediaAttrs.id === "string" ? this.__mediaAttrs.id : null;
    const fallbackName = this.__preview?.filename ?? mediaId ?? "Attachment";
    return (
      <JiraMediaDecorator mediaId={mediaId} preview={this.__preview} fallbackName={fallbackName} />
    );
  }
}

function $createJiraMediaNode(
  fields: Pick<SerializedJiraMediaNode, "mediaAttrs" | "mediaSingleAttrs" | "preview">,
): JiraMediaNode {
  return new JiraMediaNode(fields.mediaAttrs, fields.mediaSingleAttrs, fields.preview);
}

// ---------------------------------------------------------------------------
// Inline mention nodes (@user and #issue)
// ---------------------------------------------------------------------------

/**
 * A user mention. Modeled as a token {@link TextNode} so it behaves atomically
 * (deleted as a unit, never split by typing) while exporting to an ADF
 * `mention` node via {@link lexicalEditorStateToJiraAdf}.
 */
class JiraMentionNode extends TextNode {
  __mentionId: string;

  constructor(mentionId: string, text: string, key?: NodeKey) {
    super(text, key);
    this.__mentionId = mentionId;
  }

  static override getType(): string {
    return JIRA_MENTION_NODE_TYPE;
  }

  static override clone(node: JiraMentionNode): JiraMentionNode {
    return new JiraMentionNode(node.__mentionId, node.__text, node.__key);
  }

  static override importJSON(json: SerializedJiraMentionNode): JiraMentionNode {
    return $createJiraMentionNode(json.mentionId, json.text);
  }

  override exportJSON(): SerializedJiraMentionNode {
    return {
      ...super.exportJSON(),
      type: JIRA_MENTION_NODE_TYPE,
      version: 1,
      mentionId: this.__mentionId,
    };
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.className = JIRA_MENTION_CLASS;
    return dom;
  }

  override isTextEntity(): true {
    return true;
  }

  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }
}

function $createJiraMentionNode(mentionId: string, text: string): JiraMentionNode {
  const node = new JiraMentionNode(mentionId, text);
  node.setMode("token").toggleDirectionless();
  return $applyNodeReplacement(node);
}

/**
 * A reference to another issue. Modeled as a token {@link TextNode} displaying
 * the issue key; exports to an ADF `inlineCard` (a smart link) keyed by the
 * issue's browse URL.
 */
class JiraInlineCardNode extends TextNode {
  __url: string;

  constructor(url: string, text: string, key?: NodeKey) {
    super(text, key);
    this.__url = url;
  }

  static override getType(): string {
    return JIRA_INLINE_CARD_NODE_TYPE;
  }

  static override clone(node: JiraInlineCardNode): JiraInlineCardNode {
    return new JiraInlineCardNode(node.__url, node.__text, node.__key);
  }

  static override importJSON(json: SerializedJiraInlineCardNode): JiraInlineCardNode {
    return $createJiraInlineCardNode(json.url, json.text);
  }

  override exportJSON(): SerializedJiraInlineCardNode {
    return {
      ...super.exportJSON(),
      type: JIRA_INLINE_CARD_NODE_TYPE,
      version: 1,
      url: this.__url,
    };
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.className = JIRA_INLINE_CARD_CLASS;
    return dom;
  }

  override isTextEntity(): true {
    return true;
  }

  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }
}

function $createJiraInlineCardNode(url: string, text: string): JiraInlineCardNode {
  const node = new JiraInlineCardNode(url, text);
  node.setMode("token").toggleDirectionless();
  return $applyNodeReplacement(node);
}

const OPEN_JIRA_FILE_DIALOG: LexicalCommand<void> = createCommand("OPEN_JIRA_FILE_DIALOG");

export type JiraUploadHandler = (file: File) => Promise<JiraAttachment | null>;

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
  JiraMediaNode,
  JiraMentionNode,
  JiraInlineCardNode,
];

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";

function ToolbarButton(props: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly active?: boolean;
  readonly onClick: () => void;
  readonly disabled: boolean;
}) {
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant={props.active ? "secondary" : "ghost"}
            aria-label={props.label}
            aria-pressed={props.active ?? false}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function JiraEditorToolbar(props: { readonly disabled: boolean; readonly canAttach: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [formats, setFormats] = useState({
    bold: false,
    italic: false,
    strikethrough: false,
    code: false,
  });
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        setFormats({
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          strikethrough: selection.hasFormat("strikethrough"),
          code: selection.hasFormat("code"),
        });
        const anchorNode = selection.anchor.getNode();
        const element =
          anchorNode.getKey() === "root" ? anchorNode : anchorNode.getTopLevelElementOrThrow();
        const linkParent = anchorNode.getParent();
        setIsLink(
          (linkParent !== null && linkParent.getType() === "link") ||
            anchorNode.getType() === "link",
        );
        if ($isHeadingNode(element)) setBlockType(element.getTag() as BlockType);
        else if ($isQuoteNode(element)) setBlockType("quote");
        else if ($isCodeNode(element)) setBlockType("code");
        else setBlockType("paragraph");
      });
    });
  }, [editor]);

  const formatBlock = useCallback(
    (type: BlockType) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (type === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else if (type === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
        } else if (type === "code") {
          $setBlocksType(selection, () => $createCodeNode());
        } else {
          $setBlocksType(selection, () => $createHeadingNode(type as HeadingTagType));
        }
      });
    },
    [editor],
  );

  const toggleLink = useCallback(() => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const url = window.prompt("Link URL");
    if (url && url.trim().length > 0) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
    }
  }, [editor, isLink]);

  const blockLabel: Record<BlockType, string> = {
    paragraph: "Paragraph",
    h1: "Heading 1",
    h2: "Heading 2",
    h3: "Heading 3",
    quote: "Quote",
    code: "Code block",
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1 px-2"
                    disabled={props.disabled}
                    aria-label="Text style"
                  />
                }
              />
            }
          >
            <HeadingIcon className="size-4" />
            <span className="text-xs">{blockLabel[blockType]}</span>
          </TooltipTrigger>
          <TooltipPopup>Text style</TooltipPopup>
        </Tooltip>
        <DropdownMenuContent align="start">
          {(["paragraph", "h1", "h2", "h3"] as const).map((type) => (
            <DropdownMenuItem key={type} onClick={() => formatBlock(type)}>
              {blockLabel[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        icon={BoldIcon}
        label="Bold"
        active={formats.bold}
        disabled={props.disabled}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      />
      <ToolbarButton
        icon={ItalicIcon}
        label="Italic"
        active={formats.italic}
        disabled={props.disabled}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      />
      <ToolbarButton
        icon={StrikethroughIcon}
        label="Strikethrough"
        active={formats.strikethrough}
        disabled={props.disabled}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")}
      />
      <ToolbarButton
        icon={CodeIcon}
        label="Inline code"
        active={formats.code}
        disabled={props.disabled}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
      />
      <ToolbarButton
        icon={LinkIcon}
        label="Link"
        active={isLink}
        disabled={props.disabled}
        onClick={toggleLink}
      />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        icon={ListIcon}
        label="Bulleted list"
        disabled={props.disabled}
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      />
      <ToolbarButton
        icon={ListOrderedIcon}
        label="Numbered list"
        disabled={props.disabled}
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      />
      <ToolbarButton
        icon={QuoteIcon}
        label="Quote"
        active={blockType === "quote"}
        disabled={props.disabled}
        onClick={() => formatBlock(blockType === "quote" ? "paragraph" : "quote")}
      />
      <ToolbarButton
        icon={SquareCodeIcon}
        label="Code block"
        active={blockType === "code"}
        disabled={props.disabled}
        onClick={() => formatBlock(blockType === "code" ? "paragraph" : "code")}
      />
      {props.canAttach ? (
        <>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ToolbarButton
            icon={PaperclipIcon}
            label="Attach file"
            disabled={props.disabled}
            onClick={() => editor.dispatchCommand(OPEN_JIRA_FILE_DIALOG, undefined)}
          />
        </>
      ) : null}
    </div>
  );
}

function EditablePlugin(props: { readonly disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!props.disabled);
  }, [editor, props.disabled]);
  return null;
}

/**
 * Owns attachment uploads for the editor: the toolbar file dialog, drag & drop,
 * and clipboard paste. Successful uploads are inserted as media nodes; in-flight
 * uploads surface a placeholder and report busy state so the host can disable
 * submission.
 */
function JiraAttachmentPlugin(props: {
  readonly onUpload: JiraUploadHandler;
  readonly disabled: boolean;
  readonly onBusyChange?: ((busy: boolean) => void) | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const { onUpload, disabled, onBusyChange } = props;

  const uploadFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (disabled || files.length === 0) return;
      for (const file of files) {
        setInFlight((count) => count + 1);
        await onUpload(file)
          .then((attachment) => {
            if (!attachment) return;
            editor.update(() => {
              $insertNodeToNearestRoot(
                $createJiraMediaNode(jiraMediaNodeFromAttachment(attachment)),
              );
            });
          })
          .finally(() => {
            setInFlight((count) => count - 1);
          });
      }
    },
    [disabled, editor, onUpload],
  );

  useEffect(() => {
    onBusyChange?.(inFlight > 0);
  }, [inFlight, onBusyChange]);

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_JIRA_FILE_DIALOG,
        () => {
          inputRef.current?.click();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  useEffect(() => {
    const unregisterDrop = editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        event.preventDefault();
        void uploadFiles([...files]);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const files = event.clipboardData ? [...event.clipboardData.files] : [];
        const images = files.filter((file) => file.type.startsWith("image/"));
        if (images.length === 0) return false;
        event.preventDefault();
        void uploadFiles(images);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      unregisterDrop();
      unregisterPaste();
    };
  }, [editor, uploadFiles]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => {
          const files = event.target.files ? [...event.target.files] : [];
          event.target.value = "";
          void uploadFiles(files);
        }}
      />
      {inFlight > 0 ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" />
          Uploading {inFlight} file{inFlight > 1 ? "s" : ""}…
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// @user / #issue typeahead
// ---------------------------------------------------------------------------

/** Editor context needed to power the @user / #issue typeahead. */
export type JiraMentionsContext = {
  readonly environmentId: EnvironmentId;
  readonly settings: ServerSettings;
};

class JiraUserMentionOption extends MenuOption {
  constructor(readonly user: JiraMentionUser) {
    super(`user:${user.accountId}`);
  }
}

class JiraIssueMentionOption extends MenuOption {
  constructor(readonly issue: JiraIssueSummary) {
    super(`issue:${issue.key}`);
  }
}

type JiraMenuOption = JiraUserMentionOption | JiraIssueMentionOption;

const TYPEAHEAD_MAX_HEIGHT = "max-h-64";

/** The default typeahead punctuation set, minus "-", so issue keys stay matchable. */
const ISSUE_TRIGGER_PUNCTUATION = PUNCTUATION.replace("\\-", "");

/**
 * Render the floating typeahead list into the plugin's caret-anchored element.
 * Shared by the @user and #issue menus; rows differ per option type.
 */
function renderJiraMentionMenu<TOption extends JiraMenuOption>(input: {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly options: ReadonlyArray<TOption>;
  readonly selectedIndex: number | null;
  readonly selectOptionAndCleanUp: (option: TOption) => void;
  readonly setHighlightedIndex: (index: number) => void;
  readonly isPending: boolean;
  readonly emptyLabel: string;
}): ReactPortal | null {
  const anchor = input.anchorRef.current;
  if (anchor === null) return null;
  return createPortal(
    <ul
      className={cn(
        "z-50 mt-1 min-w-56 max-w-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md",
        TYPEAHEAD_MAX_HEIGHT,
      )}
      role="listbox"
    >
      {input.options.length === 0 ? (
        <li className="px-2 py-1.5 text-xs text-muted-foreground">
          {input.isPending ? "Searching…" : input.emptyLabel}
        </li>
      ) : (
        input.options.map((option, index) => (
          <li
            key={option.key}
            id={`typeahead-item-${index}`}
            ref={(element) => option.setRefElement(element)}
            role="option"
            aria-selected={input.selectedIndex === index}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5",
              input.selectedIndex === index && "bg-accent text-accent-foreground",
            )}
            onMouseEnter={() => input.setHighlightedIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => input.selectOptionAndCleanUp(option)}
          >
            {option instanceof JiraUserMentionOption ? (
              <JiraUserMentionRow user={option.user} />
            ) : (
              <JiraIssueMentionRow issue={option.issue} />
            )}
          </li>
        ))
      )}
    </ul>,
    anchor,
  );
}

function JiraMentionAvatar(props: { readonly name: string; readonly avatarUrl: string | null }) {
  if (props.avatarUrl) {
    return (
      <img
        src={props.avatarUrl}
        alt=""
        className="size-5 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  const initial = props.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6rem] font-medium text-muted-foreground">
      {initial}
    </span>
  );
}

function JiraUserMentionRow(props: { readonly user: JiraMentionUser }) {
  return (
    <>
      <JiraMentionAvatar name={props.user.displayName} avatarUrl={props.user.avatarUrl} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{props.user.displayName}</span>
        {props.user.emailAddress ? (
          <span className="truncate text-xs text-muted-foreground">{props.user.emailAddress}</span>
        ) : null}
      </span>
    </>
  );
}

function JiraIssueMentionRow(props: { readonly issue: JiraIssueSummary }) {
  return (
    <>
      <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-xs font-medium text-foreground">
        {props.issue.key}
      </span>
      <span className="truncate text-muted-foreground">{props.issue.summary}</span>
    </>
  );
}

/**
 * Registers two typeahead menus inside the editor: `@` searches mentionable
 * users (inserting an ADF `mention`), and `#` searches issues (inserting an ADF
 * `inlineCard`). Each only opens for its own trigger, so they never collide.
 */
function JiraMentionsPlugin(props: JiraMentionsContext) {
  const [editor] = useLexicalComposerContext();
  const [userQuery, setUserQuery] = useState<string | null>(null);
  const [issueQuery, setIssueQuery] = useState<string | null>(null);

  const userSearch = useJiraUserMentionSearch({
    environmentId: props.environmentId,
    settings: props.settings,
    query: userQuery,
  });
  // Fetch one broad, recency-ordered page of issues (any ticket can be
  // referenced, not just the user's filter) and rank it client-side. The server
  // query is held constant at "" while the menu is open so the page is fetched
  // once and reused as the user types, rather than per-keystroke.
  const issueSearch = useJiraMentionSearch({
    environmentId: props.environmentId,
    settings: props.settings,
    query: issueQuery === null ? null : "",
    jql: JIRA_ALL_ISSUES_JQL,
    limit: JIRA_ISSUE_MENTION_FETCH_LIMIT,
  });

  const userOptions = useMemo(
    () => userSearch.users.map((user) => new JiraUserMentionOption(user)),
    [userSearch.users],
  );
  const issueOptions = useMemo(
    () =>
      rankJiraIssues(issueSearch.issues, issueQuery ?? "")
        .slice(0, JIRA_ISSUE_MENTION_DISPLAY_LIMIT)
        .map((issue) => new JiraIssueMentionOption(issue)),
    [issueSearch.issues, issueQuery],
  );

  const atTrigger = useBasicTypeaheadTriggerMatch("@", { minLength: 0 });
  // Keep "-" a valid query char so a full issue key (PROJ-123) keeps the menu
  // open instead of closing the instant the hyphen is typed.
  const hashTrigger = useBasicTypeaheadTriggerMatch("#", {
    minLength: 0,
    punctuation: ISSUE_TRIGGER_PUNCTUATION,
  });

  const insertTokenNode = useCallback(
    (createNode: () => TextNode, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const node = createNode();
        if (nodeToReplace) nodeToReplace.replace(node);
        else $insertNodes([node]);
        const space = $createTextNode(" ");
        node.insertAfter(space);
        space.select(1, 1);
        closeMenu();
      });
    },
    [editor],
  );

  const selectUser = useCallback(
    (option: JiraUserMentionOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      insertTokenNode(
        () => $createJiraMentionNode(option.user.accountId, `@${option.user.displayName}`),
        nodeToReplace,
        closeMenu,
      );
    },
    [insertTokenNode],
  );

  const selectIssue = useCallback(
    (option: JiraIssueMentionOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      insertTokenNode(
        () => $createJiraInlineCardNode(option.issue.url, option.issue.key),
        nodeToReplace,
        closeMenu,
      );
    },
    [insertTokenNode],
  );

  return (
    <>
      <LexicalTypeaheadMenuPlugin<JiraUserMentionOption>
        triggerFn={atTrigger}
        options={userOptions}
        onQueryChange={setUserQuery}
        onSelectOption={selectUser}
        menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
          renderJiraMentionMenu({
            anchorRef,
            options: userOptions,
            selectedIndex,
            selectOptionAndCleanUp,
            setHighlightedIndex,
            isPending: userSearch.isPending,
            emptyLabel:
              (userQuery ?? "").trim().length === 0
                ? "Type to search people…"
                : "No matching people.",
          })
        }
      />
      <LexicalTypeaheadMenuPlugin<JiraIssueMentionOption>
        triggerFn={hashTrigger}
        options={issueOptions}
        onQueryChange={setIssueQuery}
        onSelectOption={selectIssue}
        menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
          renderJiraMentionMenu({
            anchorRef,
            options: issueOptions,
            selectedIndex,
            selectOptionAndCleanUp,
            setHighlightedIndex,
            isPending: issueSearch.isPending,
            emptyLabel: "No matching issues.",
          })
        }
      />
    </>
  );
}

export function JiraAdfEditor(props: {
  readonly value: JiraAdfDocument;
  readonly disabled?: boolean;
  readonly onChange: (value: JiraAdfDocument) => void;
  readonly onUpload?: JiraUploadHandler | undefined;
  readonly mediaResolutions?: JiraMediaResolutions | undefined;
  readonly onBusyChange?: ((busy: boolean) => void) | undefined;
  /** When provided, enables the `@user` / `#issue` typeahead. */
  readonly mentions?: JiraMentionsContext | undefined;
}) {
  const disabled = props.disabled ?? false;
  const canAttach = props.onUpload !== undefined;
  const resolutions = useMemo(() => props.mediaResolutions ?? {}, [props.mediaResolutions]);
  // `value` seeds the editor once; the editor is uncontrolled afterwards.
  const initialEditorState = useMemo(
    () => jiraAdfToLexicalInitialState(props.value),
    [props.value],
  );
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "jira-comment-editor",
      editable: !disabled,
      nodes: EDITOR_NODES,
      theme: EDITOR_THEME,
      ...(initialEditorState === null ? {} : { editorState: initialEditorState }),
      onError: (error) => {
        console.error("Jira comment editor error", error);
      },
    }),
    [disabled, initialEditorState],
  );

  const onChange = props.onChange;
  const handleChange = useCallback(
    (editorState: EditorState) => {
      const json = JSON.stringify(editorState.toJSON());
      onChange(lexicalEditorStateToJiraAdf(json));
    },
    [onChange],
  );

  return (
    <JiraMediaResolutionsContext.Provider value={resolutions}>
      <div
        className={cn(
          "overflow-hidden rounded-md border border-border bg-background",
          disabled && "opacity-60",
        )}
        onDragOver={
          canAttach && !disabled
            ? (event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }
            : undefined
        }
      >
        <LexicalComposer initialConfig={initialConfig}>
          {!disabled ? <JiraEditorToolbar disabled={disabled} canAttach={canAttach} /> : null}
          <div className="relative">
            <RichTextPlugin
              contentEditable={
                <ContentEditable className="max-h-64 min-h-24 overflow-y-auto px-3 py-2 text-sm leading-relaxed outline-none" />
              }
              placeholder={
                <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
                  Write a comment…
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <ListPlugin />
            <LinkPlugin />
            <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
            <EditablePlugin disabled={disabled} />
            {props.mentions && !disabled ? <JiraMentionsPlugin {...props.mentions} /> : null}
          </div>
          {props.onUpload ? (
            <JiraAttachmentPlugin
              onUpload={props.onUpload}
              disabled={disabled}
              onBusyChange={props.onBusyChange}
            />
          ) : null}
        </LexicalComposer>
      </div>
    </JiraMediaResolutionsContext.Provider>
  );
}

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  JIRA_ATTACHMENT_MAX_BYTES,
  type JiraComment,
  type JiraCommentAudience,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  EyeIcon,
  LoaderIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menu";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import {
  createEmptyJiraAdfDocument,
  hasUnsupportedJiraAdfNodes,
  jiraAdfHasContent,
} from "./jiraAdf";
import { JiraAdfEditor, JiraAdfRenderer, type JiraUploadHandler } from "./JiraRichText";
import { jiraEnvironment, useJiraComments } from "./jiraState";

const JIRA_ATTACHMENT_MAX_MB = Math.round(JIRA_ATTACHMENT_MAX_BYTES / (1024 * 1024));

/** Read a file as base64 (without the data-URI prefix) for upload over RPC. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Failed to read file.")),
      { once: true },
    );
    reader.addEventListener(
      "load",
      () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Failed to read file."));
          return;
        }
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

/**
 * Build an upload handler for the editor: enforces the size cap, reads the file
 * to base64, calls the upload command, and surfaces errors via toast. Resolves
 * to the attachment on success (so the editor inserts it) or null otherwise.
 */
function useJiraUploadHandler(
  environmentId: EnvironmentId,
  issueIdOrKey: string,
): JiraUploadHandler {
  const uploadAttachment = useAtomCommand(jiraEnvironment.uploadAttachment, {
    reportFailure: false,
  });
  return useCallback(
    async (file) => {
      if (file.size > JIRA_ATTACHMENT_MAX_BYTES) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "File too large",
            description: `Attachments must be ${JIRA_ATTACHMENT_MAX_MB} MB or smaller.`,
          }),
        );
        return null;
      }
      let contentBase64: string;
      try {
        contentBase64 = await readFileAsBase64(file);
      } catch {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not read file",
            description: "The selected file could not be read.",
          }),
        );
        return null;
      }
      const result = await uploadAttachment({
        environmentId,
        input: {
          issueIdOrKey,
          filename: file.name || "attachment",
          mimeType: file.type || "application/octet-stream",
          contentBase64,
        },
      });
      if (result._tag === "Success") {
        return result.value;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not upload attachment",
          description: error instanceof Error ? error.message : "Jira rejected the upload.",
        }),
      );
      return null;
    },
    [environmentId, issueIdOrKey, uploadAttachment],
  );
}

function relativeTime(value: string): string {
  return value ? formatRelativeTimeLabel(value) : "";
}

function CommentAuthorAvatar(props: { readonly name: string; readonly avatarUrl: string | null }) {
  if (props.avatarUrl) {
    return (
      <img
        src={props.avatarUrl}
        alt=""
        className="size-6 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  const initial = props.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[0.65rem] font-medium text-muted-foreground">
      {initial}
    </span>
  );
}

function UnsupportedNotice() {
  return (
    <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
      This comment uses formatting that isn’t supported here. Saving will simplify it to plain
      formatting.
    </p>
  );
}

/**
 * Link-style "Add internal note / Reply to customer" switch for the composer on
 * client-facing (Jira Service Management) issues. Mirrors Jira's own reply-type
 * affordance: internal notes are agent-only, public replies reach the customer.
 */
function ReplyAudienceToggle(props: {
  readonly value: JiraCommentAudience;
  readonly onChange: (value: JiraCommentAudience) => void;
  readonly disabled?: boolean;
}) {
  const item = (audience: JiraCommentAudience, label: string) => (
    <button
      type="button"
      disabled={props.disabled}
      aria-pressed={props.value === audience}
      onClick={() => props.onChange(audience)}
      className={cn(
        "rounded-sm text-sm font-medium transition-colors disabled:opacity-50",
        props.value === audience ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Reply type" className="flex items-center gap-2">
      {item("internal", "Add internal note")}
      <span aria-hidden className="text-muted-foreground/40">
        /
      </span>
      {item("public", "Reply to customer")}
    </div>
  );
}

/** Badge marking whether a service-desk comment is internal or customer-visible. */
function CommentAudienceBadge(props: { readonly jsdPublic: boolean | null }) {
  if (props.jsdPublic === null) return null;
  return props.jsdPublic ? (
    <Badge variant="outline" className="gap-1">
      <EyeIcon className="size-3" />
      Customer
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <LockIcon className="size-3" />
      Internal note
    </Badge>
  );
}

function CommentItem(props: {
  readonly comment: JiraComment;
  readonly environmentId: EnvironmentId;
  readonly settings: ServerSettings;
  readonly isServiceDesk: boolean;
  readonly onMutated: () => void;
}) {
  const { comment, environmentId } = props;
  const updateComment = useAtomCommand(jiraEnvironment.updateComment, { reportFailure: false });
  const deleteComment = useAtomCommand(jiraEnvironment.deleteComment, { reportFailure: false });
  const upload = useJiraUploadHandler(environmentId, comment.issueIdOrKey);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const bodyHasUnsupported = useMemo(
    () => hasUnsupportedJiraAdfNodes(comment.body),
    [comment.body],
  );
  const draftHasContent = useMemo(() => jiraAdfHasContent(draft), [draft]);

  const beginEdit = useCallback(() => {
    setDraft(comment.body);
    setIsEditing(true);
  }, [comment.body]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraft(comment.body);
  }, [comment.body]);

  const save = useCallback(async () => {
    if (!jiraAdfHasContent(draft) || isSaving || isUploading) return;
    setIsSaving(true);
    const result = await updateComment({
      environmentId,
      input: {
        issueIdOrKey: comment.issueIdOrKey,
        commentId: comment.id,
        body: draft,
        ...(comment.visibility ? { visibility: comment.visibility } : {}),
        // Re-assert the audience so editing an internal note doesn't flip it
        // back to customer-visible (Jira's default for edited comments). When
        // the prior visibility is unknown (jsdPublic null) we choose the safe
        // direction — internal — rather than risk exposing a note to the customer.
        ...(props.isServiceDesk
          ? { audience: comment.jsdPublic ? ("public" as const) : ("internal" as const) }
          : {}),
      },
    });
    setIsSaving(false);
    if (result._tag === "Success") {
      setIsEditing(false);
      props.onMutated();
      toastManager.add({ type: "success", title: "Comment updated" });
      return;
    }
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not update comment",
        description: error instanceof Error ? error.message : "Jira rejected the update.",
      }),
    );
  }, [comment, draft, environmentId, isSaving, isUploading, props, updateComment]);

  const confirmDelete = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    const result = await deleteComment({
      environmentId,
      input: { issueIdOrKey: comment.issueIdOrKey, commentId: comment.id },
    });
    setIsDeleting(false);
    if (result._tag === "Success") {
      setDeleteOpen(false);
      props.onMutated();
      toastManager.add({ type: "success", title: "Comment deleted" });
      return;
    }
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not delete comment",
        description: error instanceof Error ? error.message : "Jira rejected the delete.",
      }),
    );
  }, [comment, deleteComment, environmentId, isDeleting, props]);

  const edited = comment.updated && comment.updated !== comment.created;

  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <CommentAuthorAvatar
          name={comment.author.displayName}
          avatarUrl={comment.author.avatarUrl}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground">
              {comment.author.displayName}
            </span>
            <span className="text-xs text-muted-foreground">{relativeTime(comment.created)}</span>
            {edited ? <span className="text-xs text-muted-foreground">(edited)</span> : null}
            {props.isServiceDesk ? <CommentAudienceBadge jsdPublic={comment.jsdPublic} /> : null}
            {comment.visibility ? (
              <Badge variant="secondary" className="gap-1">
                <LockIcon className="size-3" />
                {comment.visibility.value}
              </Badge>
            ) : null}
            {!isEditing ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="ml-auto"
                      aria-label="Comment actions"
                    />
                  }
                >
                  <MoreHorizontalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={beginEdit}>
                    <PencilIcon className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={<a href={comment.url} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLinkIcon className="size-4" />
                    Open in Jira
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2Icon className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div className="mt-1.5">
            {isEditing ? (
              <div className="space-y-2">
                {bodyHasUnsupported ? <UnsupportedNotice /> : null}
                <JiraAdfEditor
                  value={comment.body}
                  disabled={isSaving}
                  onChange={setDraft}
                  onUpload={upload}
                  onBusyChange={setIsUploading}
                  mediaResolutions={comment.mediaResolutions}
                  mentions={{ environmentId, settings: props.settings }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={isSaving || isUploading || !draftHasContent}
                    onClick={() => void save()}
                  >
                    {isSaving ? <LoaderIcon className="size-4 animate-spin" /> : null}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" disabled={isSaving} onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <JiraAdfRenderer
                document={comment.body}
                mediaResolutions={comment.mediaResolutions}
              />
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the comment from the Jira issue. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={isDeleting} />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void confirmDelete()}
            >
              {isDeleting ? <LoaderIcon className="size-4 animate-spin" /> : null}
              Delete comment
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function AddCommentComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly issueIdOrKey: string;
  readonly settings: ServerSettings;
  readonly isServiceDesk: boolean;
  readonly onAdded: () => void;
}) {
  const addComment = useAtomCommand(jiraEnvironment.addComment, { reportFailure: false });
  const upload = useJiraUploadHandler(props.environmentId, props.issueIdOrKey);
  const [draft, setDraft] = useState(createEmptyJiraAdfDocument());
  const [composerKey, setComposerKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Default to an internal note so an agent never accidentally messages the
  // customer; they opt into a public reply explicitly. Sticky across posts.
  const [audience, setAudience] = useState<JiraCommentAudience>("internal");
  const draftHasContent = useMemo(() => jiraAdfHasContent(draft), [draft]);

  const submit = useCallback(async () => {
    if (!jiraAdfHasContent(draft) || isSubmitting || isUploading) return;
    setIsSubmitting(true);
    const result = await addComment({
      environmentId: props.environmentId,
      input: {
        issueIdOrKey: props.issueIdOrKey,
        body: draft,
        ...(props.isServiceDesk ? { audience } : {}),
      },
    });
    setIsSubmitting(false);
    if (result._tag === "Success") {
      setDraft(createEmptyJiraAdfDocument());
      setComposerKey((key) => key + 1);
      props.onAdded();
      return;
    }
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not add comment",
        description: error instanceof Error ? error.message : "Jira rejected the comment.",
      }),
    );
  }, [addComment, audience, draft, isSubmitting, isUploading, props]);

  const submitLabel = props.isServiceDesk
    ? audience === "internal"
      ? "Add internal note"
      : "Reply to customer"
    : "Comment";

  return (
    <div className="space-y-2">
      {props.isServiceDesk ? (
        <ReplyAudienceToggle value={audience} onChange={setAudience} disabled={isSubmitting} />
      ) : null}
      <JiraAdfEditor
        key={composerKey}
        value={draft}
        disabled={isSubmitting}
        onChange={setDraft}
        onUpload={upload}
        onBusyChange={setIsUploading}
        mentions={{ environmentId: props.environmentId, settings: props.settings }}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={isSubmitting || isUploading || !draftHasContent}
          onClick={() => void submit()}
        >
          {isSubmitting ? <LoaderIcon className="size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function JiraCommentsPanel(props: {
  readonly environmentId: EnvironmentId | null;
  readonly issueIdOrKey: string | null;
  readonly settings: ServerSettings;
  /** True for client-facing (JSM service-desk) issues; gates the reply-type UI. */
  readonly isServiceDesk: boolean;
  readonly onMutated?: () => void;
}) {
  const comments = useJiraComments({
    environmentId: props.environmentId,
    issueIdOrKey: props.issueIdOrKey,
    settings: props.settings,
  });

  const handleMutated = useCallback(() => {
    comments.refresh();
    props.onMutated?.();
  }, [comments, props]);

  if (props.environmentId === null || props.issueIdOrKey === null) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comments
        </h3>
        {comments.isPending ? (
          <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label="Refresh comments"
          onClick={comments.refresh}
        >
          <RefreshCwIcon className={cn("size-4", comments.isPending && "animate-spin")} />
        </Button>
      </div>

      <AddCommentComposer
        // Remount per issue so the draft and the (sticky) reply-type selection
        // reset when switching tickets — never carry a "Reply to customer"
        // choice or a half-typed comment from one ticket to another.
        key={props.issueIdOrKey}
        environmentId={props.environmentId}
        issueIdOrKey={props.issueIdOrKey}
        settings={props.settings}
        isServiceDesk={props.isServiceDesk}
        onAdded={handleMutated}
      />

      {comments.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          {comments.error}
        </div>
      ) : null}

      <div>
        {comments.comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            environmentId={props.environmentId!}
            settings={props.settings}
            isServiceDesk={props.isServiceDesk}
            onMutated={handleMutated}
          />
        ))}
        {comments.comments.length === 0 && !comments.isPending && !comments.error ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No comments yet.</p>
        ) : null}
      </div>

      {comments.hasNextPage ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={comments.isLoadingNext}
          onClick={comments.loadNext}
        >
          {comments.isLoadingNext ? <LoaderIcon className="size-4 animate-spin" /> : null}
          Load more comments
        </Button>
      ) : null}
    </section>
  );
}

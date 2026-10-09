import type { McpOAuthTrustReview } from "@t3tools/contracts";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

function originFor(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : "Invalid URL";
}

/** A one-attempt decision about exact discovered endpoints, never a global security switch. */
export function McpOAuthTrustDialog({
  review,
  open,
  pending,
  canManage,
  replaced,
  error,
  onCancel,
  onContinue,
  onDismiss,
}: {
  readonly review: McpOAuthTrustReview;
  readonly open: boolean;
  readonly pending: boolean;
  readonly canManage: boolean;
  readonly replaced: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
}) {
  const urls = [
    ["MCP resource", review.profile.resource],
    ["Issuer", review.profile.issuer],
    ["Authorization endpoint", review.profile.authorizationEndpoint],
    ["Token endpoint", review.profile.tokenEndpoint],
    ["Client registration endpoint", review.profile.registrationEndpoint],
  ] as const;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onDismiss()}>
      <DialogPopup showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Review OAuth server trust</DialogTitle>
          <DialogDescription>
            Only continue if you independently trust this MCP server and the sign-in service below.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <p className="text-sm text-warning">
              This connection needs your trust review. Without issuer identification on return, a
              malicious service could misdirect your sign-in. Approving these addresses does not
              prove that the returning issuer is genuine or that the service is trustworthy.
            </p>
            {replaced ? (
              <p className="text-sm" role="status">
                Your previous review no longer applies. Check these current details before
                continuing again.
              </p>
            ) : null}
            <dl className="space-y-3">
              {urls.map(([label, url]) => (
                <div key={label}>
                  <dt className="text-xs font-medium">{label}</dt>
                  <dd className="mt-1 space-y-1">
                    <p className="break-all font-mono text-xs select-text">{url}</p>
                    <p className="break-all text-xs text-muted-foreground select-text">
                      Origin: {originFor(url)}
                    </p>
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-medium">Requested scopes</dt>
                <dd className="mt-1">
                  {review.profile.requestedScopes.length > 0 ? (
                    <ul className="list-inside list-disc space-y-1 break-all font-mono text-xs select-text">
                      {review.profile.requestedScopes.map((scope) => (
                        <li key={scope}>{scope}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No explicit scopes requested.</p>
                  )}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              T3 Code will register an OAuth client and open sign-in only after you continue. This
              approval applies to these details for this sign-in attempt.
            </p>
            {error ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={pending || !canManage} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={pending || !canManage} onClick={onContinue}>
            {pending ? "Continuing…" : "Trust this server and continue"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

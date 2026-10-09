import type { EnvironmentId, McpOAuthTarget } from "@t3tools/contracts";

import { Button } from "../ui/button";
import { McpOAuthTrustDialog } from "./McpOAuthTrustDialog";
import { useMcpOAuthControls } from "./useMcpOAuthControls";

export function McpOAuthControls({
  environmentId,
  input,
  inherited,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: McpOAuthTarget;
  readonly inherited: boolean;
}) {
  const controls = useMcpOAuthControls(environmentId, input);
  const status = controls.status?.status;
  const description = !controls.canRead
    ? "Connection status needs permission to manage providers."
    : status === "connected"
      ? "Connected"
      : status === "trust-required"
        ? "Review server trust before signing in"
        : status === "connecting"
          ? "Finish sign-in in your browser"
          : status === "expired"
            ? "Sign-in expired. Connect again."
            : status === "disconnected"
              ? "Not connected"
              : "Checking connection…";
  return (
    <div className="flex max-w-sm flex-wrap items-center justify-end gap-1.5">
      <span className="text-xs text-muted-foreground" role="status">
        {description}
        {inherited ? " (environment account)" : ""}
      </span>
      {controls.canRead ? (
        status === "trust-required" ? (
          <>
            <Button
              size="xs"
              variant="outline"
              disabled={controls.pending}
              onClick={controls.openReview}
            >
              Review sign-in
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!controls.canManage || controls.pending}
              onClick={() => void controls.cancel()}
            >
              Cancel
            </Button>
          </>
        ) : status === "connecting" ? (
          <>
            {controls.canOpenSignIn ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!controls.canManage || controls.pending}
                aria-label={`Open sign-in for ${input.name}`}
                onClick={() => void controls.openSignIn()}
              >
                Open sign-in
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              disabled={!controls.canManage || controls.pending || !controls.status?.flowId}
              aria-label={`Cancel sign-in for ${input.name}`}
              onClick={() => void controls.cancel()}
            >
              Cancel
            </Button>
          </>
        ) : status === "connected" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!controls.canManage || controls.pending}
            aria-label={`Disconnect ${input.name}`}
            onClick={() => void controls.disconnect()}
          >
            Disconnect
          </Button>
        ) : status !== undefined ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!controls.canManage || controls.pending}
            aria-label={`Connect ${input.name}`}
            onClick={() => void controls.connect()}
          >
            {controls.pending ? "Connecting…" : "Connect"}
          </Button>
        ) : null
      ) : null}
      {controls.review ? (
        <McpOAuthTrustDialog
          review={controls.review}
          open={controls.reviewOpen}
          pending={controls.pending}
          canManage={controls.canManage}
          replaced={controls.reviewReplaced}
          error={controls.error}
          onCancel={() => void controls.cancel()}
          onContinue={() => void controls.acceptReview()}
          onDismiss={controls.dismissReview}
        />
      ) : null}
      {controls.canRead && !controls.canManage ? (
        <span className="w-full text-right text-xs text-muted-foreground">
          Changing sign-in needs permission to manage providers and settings.
        </span>
      ) : null}
      {controls.status?.message && controls.canRead ? (
        <span className="w-full text-right text-xs text-muted-foreground" role="status">
          {controls.status.message}
        </span>
      ) : null}
      {controls.error ? (
        <div className="w-full text-right text-xs text-destructive-foreground" role="alert">
          {controls.error}{" "}
          <Button
            size="xs"
            variant="ghost"
            disabled={controls.pending}
            onClick={() => void controls.refresh()}
          >
            Retry status
          </Button>
        </div>
      ) : null}
    </div>
  );
}

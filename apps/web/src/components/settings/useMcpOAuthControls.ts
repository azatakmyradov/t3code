import { useAtomValue } from "@effect/atom-react";
import {
  McpOAuthError,
  type EnvironmentId,
  type McpOAuthStatus,
  type McpOAuthTarget,
  type McpOAuthTrustReview,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const isMcpOAuthError = Schema.is(McpOAuthError);
const commandOptions = { reportFailure: false, reportDefect: false };

/** Mount keyed by the saved credential owner and URL. Detached reads cannot open a late sign-in window. */
export function useMcpOAuthControls(environmentId: EnvironmentId, input: McpOAuthTarget) {
  const target = useMemo(
    () => ({
      environmentId,
      input: { name: input.name, ...(input.projectId ? { projectId: input.projectId } : {}) },
    }),
    [environmentId, input.name, input.projectId],
  );
  const canRead = useAtomValue(serverEnvironment.mcpOAuth.status.permissionAtom(environmentId));
  const canManage = useAtomValue(serverEnvironment.mcpOAuth.begin.permissionAtom(environmentId));
  const read = useAtomCommand(serverEnvironment.mcpOAuth.status, commandOptions);
  const begin = useAtomCommand(serverEnvironment.mcpOAuth.begin, commandOptions);
  const cancel = useAtomCommand(serverEnvironment.mcpOAuth.cancel, commandOptions);
  const disconnect = useAtomCommand(serverEnvironment.mcpOAuth.disconnect, commandOptions);
  const [status, setStatus] = useState<McpOAuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReplaced, setReviewReplaced] = useState(false);
  const [authorization, setAuthorization] = useState<{ flowId: string; url: string } | null>(null);
  const lifecycle = useRef({
    active: false,
    pending: false,
    reads: 0,
    generation: 0,
    reviewId: null as string | null,
  });

  const refresh = useCallback(async () => {
    if (!canRead || !lifecycle.current.active || lifecycle.current.pending) return;
    const generation = lifecycle.current.generation;
    const request = ++lifecycle.current.reads;
    const result = await read(target);
    if (
      !lifecycle.current.active ||
      lifecycle.current.generation !== generation ||
      lifecycle.current.reads !== request
    )
      return;
    if (result._tag === "Success") {
      const reviewId = result.value.status === "trust-required" ? result.value.flowId : null;
      if (
        lifecycle.current.reviewId !== null &&
        reviewId !== null &&
        lifecycle.current.reviewId !== reviewId
      ) {
        setReviewReplaced(true);
      }
      lifecycle.current.reviewId = reviewId;
      if (reviewId === null) {
        setReviewOpen(false);
        setReviewReplaced(false);
      }
      setStatus(result.value);
      setStatusError(null);
      if (result.value.status === "connected") setError(null);
      setAuthorization((current) =>
        result.value.status === "connecting" && result.value.flowId === current?.flowId
          ? current
          : null,
      );
    } else {
      setStatusError(
        "Could not check the connection. Try again when this environment is available.",
      );
    }
  }, [canRead, read, target]);

  useEffect(() => {
    lifecycle.current.active = true;
    lifecycle.current.generation++;
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.generation++;
    };
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (status?.status !== "connecting") return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.status]);

  async function start(approvedReviewId?: string) {
    if (
      !lifecycle.current.active ||
      !canManage ||
      lifecycle.current.pending ||
      status?.status === "connecting"
    )
      return;
    if (
      approvedReviewId !== undefined &&
      (status?.status !== "trust-required" || status.flowId !== approvedReviewId)
    )
      return;
    if (approvedReviewId === undefined && status?.status === "trust-required") {
      setReviewOpen(true);
      return;
    }
    lifecycle.current.pending = true;
    setPending(true);
    setError(null);
    lifecycle.current.reads++;
    const generation = lifecycle.current.generation;
    // Reserve a web tab during the click gesture. Desktop uses the shared shell API.
    let tab: Window | null = null;
    try {
      tab = !window.desktopBridge ? window.open("", "_blank") : null;
      if (tab) tab.opener = null;
      const result = await begin({
        ...target,
        input: {
          ...target.input,
          ...(approvedReviewId === undefined ? {} : { approvedReviewId }),
        },
      });
      if (result._tag !== "Success") {
        tab?.close();
        if (lifecycle.current.active && lifecycle.current.generation === generation) {
          const failure = squashAtomCommandFailure(result);
          setError(
            isMcpOAuthError(failure)
              ? failure.message
              : "Could not start sign-in. Check that this server supports OAuth and try again.",
          );
        }
        return;
      }
      if (!lifecycle.current.active || lifecycle.current.generation !== generation) {
        tab?.close();
        await cancel({ ...target, input: { ...target.input, flowId: result.value.flowId } });
        return;
      }
      if (result.value._tag === "trust-required") {
        tab?.close();
        lifecycle.current.reviewId = result.value.flowId;
        setAuthorization(null);
        setStatus({
          status: "trust-required",
          flowId: result.value.flowId,
          expiresAt: result.value.expiresAt,
          profile: result.value.profile,
        });
        setReviewReplaced(approvedReviewId !== undefined);
        setReviewOpen(true);
        return;
      }
      lifecycle.current.reviewId = null;
      setReviewOpen(false);
      const authorizationUrl = URL.canParse(result.value.authorizationUrl)
        ? new URL(result.value.authorizationUrl)
        : null;
      if (
        authorizationUrl === null ||
        !["https:", "http:"].includes(authorizationUrl.protocol) ||
        authorizationUrl.username ||
        authorizationUrl.password
      ) {
        tab?.close();
        await cancel({ ...target, input: { ...target.input, flowId: result.value.flowId } });
        setError("The server returned an invalid sign-in link. Check its OAuth configuration.");
        return;
      }
      setStatus({
        status: "connecting",
        flowId: result.value.flowId,
        expiresAt: result.value.expiresAt,
      });
      setAuthorization({ flowId: result.value.flowId, url: result.value.authorizationUrl });
      if (tab && !tab.closed) tab.location.href = result.value.authorizationUrl;
      else if (window.desktopBridge)
        await ensureLocalApi().shell.openExternal(result.value.authorizationUrl);
      else setError("Your browser blocked the sign-in tab. Choose Open sign-in to continue.");
    } catch {
      tab?.close();
      if (lifecycle.current.active && lifecycle.current.generation === generation) {
        setError("Could not open sign-in. Try again.");
      }
    } finally {
      lifecycle.current.pending = false;
      if (lifecycle.current.active && lifecycle.current.generation === generation) {
        setPending(false);
        // The browser may have returned before opening it finished.
        void refresh();
      }
    }
  }

  async function stop(disconnectAccount: boolean) {
    if (!lifecycle.current.active || !canManage || lifecycle.current.pending) return;
    const flowId = status?.flowId;
    if (!disconnectAccount && !flowId) return;
    const generation = lifecycle.current.generation;
    lifecycle.current.pending = true;
    lifecycle.current.reads++;
    setPending(true);
    setError(null);
    const result = disconnectAccount
      ? await disconnect(target)
      : await cancel({ ...target, input: { ...target.input, flowId: flowId! } });
    lifecycle.current.pending = false;
    if (!lifecycle.current.active || lifecycle.current.generation !== generation) return;
    setPending(false);
    if (result._tag === "Success") {
      lifecycle.current.reviewId = null;
      setStatus({ status: "disconnected" });
      setAuthorization(null);
      setReviewOpen(false);
      void refresh();
    } else {
      setError(
        disconnectAccount
          ? "Could not disconnect. Try again."
          : "Could not cancel sign-in. Try again.",
      );
    }
  }

  async function openSignIn() {
    if (
      !lifecycle.current.active ||
      !canManage ||
      lifecycle.current.pending ||
      !authorization ||
      status?.flowId !== authorization.flowId
    )
      return;
    lifecycle.current.pending = true;
    setPending(true);
    try {
      await ensureLocalApi().shell.openExternal(authorization.url);
      if (lifecycle.current.active) setError(null);
    } catch {
      if (lifecycle.current.active)
        setError("Could not open the sign-in page. Check your browser settings and try again.");
    } finally {
      lifecycle.current.pending = false;
      if (lifecycle.current.active) setPending(false);
    }
  }

  const review: McpOAuthTrustReview | null =
    status?.status === "trust-required"
      ? {
          _tag: "trust-required",
          flowId: status.flowId,
          expiresAt: status.expiresAt,
          profile: status.profile,
        }
      : null;

  return {
    status,
    review,
    reviewOpen: reviewOpen && review !== null,
    reviewReplaced,
    openReview: () => setReviewOpen(true),
    dismissReview: () => {
      if (lifecycle.current.pending) return;
      if (canManage) void stop(false);
      else setReviewOpen(false);
    },
    acceptReview: () => (review === null ? Promise.resolve() : start(review.flowId)),
    error: error ?? statusError,
    pending,
    canRead,
    canManage,
    canOpenSignIn:
      authorization !== null &&
      status?.status === "connecting" &&
      status.flowId === authorization.flowId,
    connect: () => start(),
    cancel: () => stop(false),
    disconnect: () => stop(true),
    openSignIn,
    refresh,
  };
}

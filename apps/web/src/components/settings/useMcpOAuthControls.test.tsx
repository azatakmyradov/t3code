import {
  McpOAuthError,
  EnvironmentId,
  type McpOAuthBeginResult,
  type McpOAuthStatus,
  type McpOAuthTrustReview,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useMcpOAuthControls } from "./useMcpOAuthControls";

type Success<A> = { _tag: "Success"; value: A };
type Failure = { _tag: "Failure"; cause: Cause.Cause<unknown> };
const success = <A,>(value: A): Success<A> => ({ _tag: "Success", value });
const state = vi.hoisted(() => ({
  allowed: true,
  status: vi.fn<() => Promise<Success<McpOAuthStatus>>>(),
  begin: vi.fn<() => Promise<Success<McpOAuthBeginResult> | Failure>>(),
  cancel: vi.fn(),
  disconnect: vi.fn(),
  open: vi.fn(),
  shellOpen: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.allowed }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    mcpOAuth: Object.fromEntries(
      ["status", "begin", "cancel", "disconnect"].map((method) => [
        method,
        { method, permissionAtom: () => method },
      ]),
    ),
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: ({ method }: { method: "status" | "begin" | "cancel" | "disconnect" }) =>
    state[method],
}));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: state.shellOpen } }),
}));

const environmentId = EnvironmentId.make("environment-a");
const flow = {
  _tag: "authorization",
  flowId: "flow-a",
  authorizationUrl: "https://vendor.example/authorize?state=opaque",
  expiresAt: Date.now() + 600_000,
} satisfies McpOAuthBeginResult;
const review: McpOAuthTrustReview = {
  _tag: "trust-required",
  flowId: "review-a",
  expiresAt: Date.now() + 600_000,
  profile: {
    resource: "https://tools.example/mcp",
    issuer: "https://vendor.example",
    authorizationEndpoint: "https://vendor.example/authorize",
    tokenEndpoint: "https://vendor.example/token",
    registrationEndpoint: "https://vendor.example/register",
    requestedScopes: ["tools:read", "tools:write"],
  },
};
const reviewStatus = (value = review): McpOAuthStatus => ({
  status: "trust-required",
  flowId: value.flowId,
  expiresAt: value.expiresAt,
  profile: value.profile,
});
let renderer: ReactTestRenderer | undefined;
let controls: ReturnType<typeof useMcpOAuthControls>;
let tab: {
  opener: unknown;
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
  location: { href: string };
};
function Probe({ name = "tools" }: { name?: string }) {
  const next = useMcpOAuthControls(environmentId, { name });
  useEffect(() => {
    controls = next;
  }, [next]);
  return null;
}
function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount() {
  await act(async () => {
    renderer = create(<Probe />);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.allowed = true;
  state.listeners.clear();
  state.status.mockReset().mockResolvedValue(success({ status: "disconnected" }));
  state.begin.mockReset().mockResolvedValue(success(flow));
  state.cancel.mockReset().mockResolvedValue(success(undefined));
  state.disconnect.mockReset().mockResolvedValue(success(undefined));
  state.shellOpen.mockReset().mockResolvedValue(undefined);
  tab = { opener: {}, closed: false, close: vi.fn(), location: { href: "" } };
  state.open.mockReset().mockReturnValue(tab);
  vi.stubGlobal("window", {
    open: state.open,
    addEventListener: (type: string, fn: () => void) => state.listeners.set(type, fn),
    removeEventListener: (type: string) => state.listeners.delete(type),
    setInterval,
    clearInterval,
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared MCP browser sign-in", () => {
  it("starts once under rapid clicks, opens the browser, and follows completion", async () => {
    await mount();
    const started = deferred<Success<McpOAuthBeginResult>>();
    state.begin.mockReturnValueOnce(started.promise);
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = controls.connect();
      await controls.connect();
    });
    expect(state.begin).toHaveBeenCalledOnce();
    expect(state.open).toHaveBeenCalledOnce();
    expect(controls.pending).toBe(true);
    await act(async () => {
      started.resolve(success(flow));
      await pending;
    });
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(flow.authorizationUrl);
    expect(controls.status?.status).toBe("connecting");
    state.status.mockResolvedValue(success({ status: "connected" }));
    await act(async () => {
      state.listeners.get("focus")?.();
    });
    expect(controls.status?.status).toBe("connected");
    expect(controls.canOpenSignIn).toBe(false);
    const readCount = state.status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(state.status).toHaveBeenCalledTimes(readCount);
  });

  it("cancels a late begin after navigating away without opening its authorization URL", async () => {
    await mount();
    const started = deferred<Success<McpOAuthBeginResult>>();
    state.begin.mockReturnValueOnce(started.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = controls.connect();
    });
    await act(async () => {
      renderer!.update(<Probe key="other-tools" name="other-tools" />);
    });
    await act(async () => {
      started.resolve(success(flow));
      await pending;
    });
    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.href).toBe("");
    expect(state.cancel).toHaveBeenCalledWith({
      environmentId,
      input: { name: "tools", flowId: flow.flowId },
    });
    expect(controls.pending).toBe(false);
    expect(controls.status?.status).toBe("disconnected");
  });

  it("cancels the exact flow and ignores an older status response", async () => {
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await mount();
    const delayed = deferred<Success<McpOAuthStatus>>();
    state.status.mockReturnValueOnce(delayed.promise);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = controls.refresh();
    });
    state.status.mockResolvedValue(success({ status: "disconnected" }));
    await act(async () => {
      await controls.cancel();
    });
    await act(async () => {
      delayed.resolve(success({ status: "connecting", flowId: "old-flow" }));
      await refresh;
    });
    expect(state.cancel).toHaveBeenCalledWith({
      environmentId,
      input: { name: "tools", flowId: flow.flowId },
    });
    expect(controls.status?.status).toBe("disconnected");
    expect(controls.canOpenSignIn).toBe(false);
  });

  it("offers a direct retry when a popup is blocked and polls while connecting", async () => {
    state.open.mockReturnValue(null);
    await mount();
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await act(async () => {
      await controls.connect();
    });
    expect(controls.canOpenSignIn).toBe(true);
    expect(state.shellOpen).not.toHaveBeenCalled();
    await act(async () => {
      await controls.openSignIn();
    });
    expect(state.shellOpen).toHaveBeenCalledWith(flow.authorizationUrl);
    state.status.mockResolvedValue(success({ status: "connected" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(controls.status?.status).toBe("connected");
  });

  it("disconnects the saved owner and does not expose controls without permission", async () => {
    state.status.mockResolvedValue(success({ status: "connected" }));
    await mount();
    state.status.mockResolvedValue(success({ status: "disconnected" }));
    await act(async () => {
      await controls.disconnect();
    });
    expect(state.disconnect).toHaveBeenCalledWith({ environmentId, input: { name: "tools" } });
    expect(controls.status?.status).toBe("disconnected");
    state.allowed = false;
    await act(async () => {
      renderer!.update(<Probe />);
    });
    await act(async () => {
      await controls.connect();
      await controls.disconnect();
    });
    expect(state.begin).not.toHaveBeenCalled();
    expect(state.open).not.toHaveBeenCalled();
    expect(state.disconnect).toHaveBeenCalledOnce();
  });
});

it("preserves an actionable safe OAuth failure after status refresh", async () => {
  await mount();
  state.begin.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(
      new McpOAuthError({
        code: "unsupported",
        message: "This server does not support automatic OAuth client registration.",
      }),
    ),
  });
  await act(async () => {
    await controls.connect();
  });
  expect(tab.close).toHaveBeenCalledOnce();
  expect(tab.location.href).toBe("");
  expect(controls.error).toContain("client registration");
  await act(async () => {
    await controls.refresh();
  });
  expect(controls.error).toContain("client registration");
});

it("cancels unsafe authorization URLs instead of navigating to them", async () => {
  await mount();
  state.begin.mockResolvedValueOnce(success({ ...flow, authorizationUrl: "javascript:alert(1)" }));
  await act(async () => {
    await controls.connect();
  });
  expect(tab.close).toHaveBeenCalledOnce();
  expect(tab.location.href).toBe("");
  expect(state.shellOpen).not.toHaveBeenCalled();
  expect(state.cancel).toHaveBeenCalledWith({
    environmentId,
    input: { name: "tools", flowId: flow.flowId },
  });
  expect(controls.error).toContain("invalid sign-in link");
});

it("does not reopen an old authorization URL after another client replaces the flow", async () => {
  await mount();
  state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
  await act(async () => {
    await controls.connect();
  });
  expect(controls.canOpenSignIn).toBe(true);
  state.status.mockResolvedValue(success({ status: "connecting", flowId: "new-flow" }));
  await act(async () => {
    await controls.refresh();
  });
  expect(controls.canOpenSignIn).toBe(false);
  await act(async () => {
    await controls.openSignIn();
  });
  expect(state.shellOpen).not.toHaveBeenCalled();
});

describe("MCP issuer trust review", () => {
  it("never navigates to sign-in before accepting the exact review", async () => {
    await mount();
    state.begin.mockResolvedValueOnce(success(review));
    state.status.mockResolvedValue(success(reviewStatus()));
    await act(async () => {
      await controls.connect();
    });
    expect(controls.review).toEqual(review);
    expect(controls.reviewOpen).toBe(true);
    expect(controls.reviewReplaced).toBe(false);
    expect(controls.canOpenSignIn).toBe(false);
    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.href).toBe("");
    expect(state.shellOpen).not.toHaveBeenCalled();
    await act(async () => {
      await controls.connect();
      await controls.openSignIn();
    });
    expect(state.begin).toHaveBeenCalledOnce();
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await act(async () => {
      await controls.acceptReview();
    });
    expect(state.begin).toHaveBeenLastCalledWith({
      environmentId,
      input: { name: "tools", approvedReviewId: review.flowId },
    });
    expect(tab.location.href).toBe(flow.authorizationUrl);
    expect(controls.reviewOpen).toBe(false);
    expect(controls.canOpenSignIn).toBe(true);
  });

  it("requires another deliberate approval when discovery replaces reviewed metadata", async () => {
    state.status.mockResolvedValue(success(reviewStatus()));
    await mount();
    const replacement: McpOAuthTrustReview = {
      ...review,
      flowId: "review-b",
      profile: { ...review.profile, tokenEndpoint: "https://changed.example/token" },
    };
    state.begin.mockResolvedValueOnce(success(replacement));
    state.status.mockResolvedValue(success(reviewStatus(replacement)));
    await act(async () => {
      await controls.acceptReview();
    });
    expect(state.begin).toHaveBeenCalledOnce();
    expect(controls.review).toEqual(replacement);
    expect(controls.reviewOpen).toBe(true);
    expect(controls.reviewReplaced).toBe(true);
    expect(tab.location.href).toBe("");
    expect(state.shellOpen).not.toHaveBeenCalled();
    await act(async () => {
      await controls.refresh();
    });
    expect(state.begin).toHaveBeenCalledOnce();
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await act(async () => {
      await controls.acceptReview();
    });
    expect(state.begin).toHaveBeenLastCalledWith({
      environmentId,
      input: { name: "tools", approvedReviewId: replacement.flowId },
    });
    expect(tab.location.href).toBe(flow.authorizationUrl);
  });

  it("flags a review replaced by another client and waits for approval of its current details", async () => {
    state.status.mockResolvedValue(success(reviewStatus()));
    await mount();
    await act(async () => {
      controls.openReview();
    });
    const replacement: McpOAuthTrustReview = {
      ...review,
      flowId: "review-from-other-client",
      profile: { ...review.profile, requestedScopes: ["tools:read", "admin"] },
    };
    state.status.mockResolvedValue(success(reviewStatus(replacement)));
    await act(async () => {
      await controls.refresh();
    });
    expect(controls.review).toEqual(replacement);
    expect(controls.reviewReplaced).toBe(true);
    expect(controls.reviewOpen).toBe(true);
    expect(state.begin).not.toHaveBeenCalled();
    expect(state.open).not.toHaveBeenCalled();
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await act(async () => {
      await controls.acceptReview();
    });
    expect(state.begin).toHaveBeenCalledWith({
      environmentId,
      input: { name: "tools", approvedReviewId: replacement.flowId },
    });
  });

  it("cancels on dismissal without granting trust or opening a sign-in link", async () => {
    state.status.mockResolvedValue(success(reviewStatus()));
    await mount();
    await act(async () => {
      controls.openReview();
    });
    expect(controls.reviewOpen).toBe(true);
    state.status.mockResolvedValue(success({ status: "disconnected" }));
    await act(async () => {
      controls.dismissReview();
    });
    expect(state.cancel).toHaveBeenCalledWith({
      environmentId,
      input: { name: "tools", flowId: review.flowId },
    });
    expect(controls.reviewOpen).toBe(false);
    expect(controls.review).toBeNull();
    await act(async () => {
      await controls.acceptReview();
    });
    expect(state.begin).not.toHaveBeenCalled();
    expect(state.open).not.toHaveBeenCalled();
    expect(state.shellOpen).not.toHaveBeenCalled();
  });

  it("cancels a review arriving after navigation instead of displaying it", async () => {
    await mount();
    const started = deferred<Success<McpOAuthBeginResult>>();
    state.begin.mockReturnValueOnce(started.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = controls.connect();
    });
    await act(async () => {
      renderer!.update(<Probe key="other-tools" name="other-tools" />);
    });
    await act(async () => {
      started.resolve(success(review));
      await pending;
    });
    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.href).toBe("");
    expect(state.cancel).toHaveBeenCalledWith({
      environmentId,
      input: { name: "tools", flowId: review.flowId },
    });
    expect(controls.review).toBeNull();
    expect(controls.reviewOpen).toBe(false);
  });

  it("ignores repeated approvals and cancels their late authorization after navigation", async () => {
    state.status.mockResolvedValue(success(reviewStatus()));
    await mount();
    const started = deferred<Success<McpOAuthBeginResult>>();
    state.begin.mockReturnValueOnce(started.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = controls.acceptReview();
      await controls.acceptReview();
      controls.dismissReview();
    });
    expect(state.begin).toHaveBeenCalledOnce();
    expect(state.cancel).not.toHaveBeenCalled();
    state.status.mockResolvedValue(success({ status: "disconnected" }));
    await act(async () => {
      renderer!.update(<Probe key="other-tools" name="other-tools" />);
    });
    await act(async () => {
      started.resolve(success(flow));
      await pending;
    });
    expect(tab.location.href).toBe("");
    expect(state.cancel).toHaveBeenCalledWith({
      environmentId,
      input: { name: "tools", flowId: flow.flowId },
    });
    expect(controls.canOpenSignIn).toBe(false);
  });

  it("keeps the review available when cancellation fails, then allows another cancel", async () => {
    state.status.mockResolvedValue(success(reviewStatus()));
    await mount();
    state.cancel.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("offline")),
    });
    await act(async () => {
      controls.openReview();
    });
    await act(async () => {
      controls.dismissReview();
    });
    expect(controls.pending).toBe(false);
    expect(controls.reviewOpen).toBe(true);
    expect(controls.error).toContain("Could not cancel");
    state.status.mockResolvedValue(success({ status: "disconnected" }));
    await act(async () => {
      await controls.cancel();
    });
    expect(controls.reviewOpen).toBe(false);
    expect(controls.error).toBeNull();
    expect(state.begin).not.toHaveBeenCalled();
  });

  it("discards an expired review and allows a fresh sign-in attempt", async () => {
    state.status.mockResolvedValue(success(reviewStatus()));
    await mount();
    state.begin.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(
        new McpOAuthError({ code: "expired", message: "Sign-in expired. Connect again." }),
      ),
    });
    state.status.mockResolvedValue(success({ status: "expired" }));
    await act(async () => {
      await controls.acceptReview();
    });
    expect(tab.location.href).toBe("");
    expect(controls.review).toBeNull();
    expect(controls.reviewOpen).toBe(false);
    expect(controls.error).toContain("expired");
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await act(async () => {
      await controls.connect();
    });
    expect(state.begin).toHaveBeenLastCalledWith({ environmentId, input: { name: "tools" } });
    expect(tab.location.href).toBe(flow.authorizationUrl);
  });

  it("uses the desktop shell only after explicit review approval", async () => {
    vi.stubGlobal("window", { ...window, desktopBridge: {} });
    await mount();
    state.begin.mockResolvedValueOnce(success(review));
    state.status.mockResolvedValue(success(reviewStatus()));
    await act(async () => {
      await controls.connect();
    });
    expect(state.open).not.toHaveBeenCalled();
    expect(state.shellOpen).not.toHaveBeenCalled();
    state.status.mockResolvedValue(success({ status: "connecting", flowId: flow.flowId }));
    await act(async () => {
      await controls.acceptReview();
    });
    expect(state.shellOpen).toHaveBeenCalledWith(flow.authorizationUrl);
    expect(controls.reviewOpen).toBe(false);
  });
});

import {
  type AdvertisedEndpoint,
  type AuthClientMetadata,
  type AuthGrantScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type DesktopBridge,
  type DesktopServerExposureState,
  type DesktopUpdateState,
  type DesktopSshEnvironmentTarget,
  type DesktopWslState,
  type EnvironmentId,
  type ServerAuthPolicy,
  type ServerDirectEndpoint,
} from "@t3tools/contracts";
import {
  getDesktopUpdateDownloadedVersion,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import { setPairingTokenOnUrl } from "@t3tools/shared/remote";
import { msg } from "gt-react";
import { isLoopbackHostname } from "~/environments/primary";
import { m, type MessageResolver } from "../../i18n/messages";

/** Keep terminal:read with terminal:operate to avoid creating unseen shells on every script run. */
export function togglePairingScopeSelection(
  current: ReadonlyArray<AuthGrantScope>,
  scope: AuthGrantScope,
  checked: boolean,
): ReadonlyArray<AuthGrantScope> {
  const without = (scopes: ReadonlyArray<AuthGrantScope>) =>
    scopes.filter((currentScope) => currentScope !== scope);
  if (!checked) {
    return scope === AuthTerminalReadScope
      ? without(current).filter((currentScope) => currentScope !== AuthTerminalOperateScope)
      : without(current);
  }
  const next = [...without(current), scope];
  return scope === AuthTerminalOperateScope && !next.includes(AuthTerminalReadScope)
    ? [...next, AuthTerminalReadScope]
    : next;
}

export function canRevokeOtherClients(
  clientSessions: ReadonlyArray<{ readonly current: boolean }> | null,
): boolean {
  return clientSessions === null || clientSessions.some((session) => !session.current);
}

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

/** Never offer loopback URLs as QR targets; scanning devices would connect to themselves. */
export function isQrShareableEndpoint(endpoint: AdvertisedEndpoint): boolean {
  return endpoint.status !== "unavailable" && endpoint.reachability !== "loopback";
}

/** Desktop skips Tailscale probing until network/Serve is enabled to avoid macOS prompts; absence then
 * means unchecked. */
export function missingTailscaleEndpointDescription(
  state: Pick<DesktopServerExposureState, "mode" | "tailscaleServeEnabled"> | null,
  resolve: MessageResolver = m,
): string {
  return state && state.mode !== "network-accessible" && !state.tailscaleServeEnabled
    ? resolve(msg("Turn on Network access to detect Tailscale."))
    : resolve(msg("Start Tailscale to set up HTTPS access through MagicDNS."));
}

export function resolveTailscaleServeBaseUrl(
  endpoint: Pick<AdvertisedEndpoint, "httpBaseUrl"> | null,
  port: number,
  isPortValid: boolean,
): string | null {
  if (!endpoint) return null;
  if (!isPortValid) return endpoint.httpBaseUrl;
  try {
    const url = new URL(endpoint.httpBaseUrl);
    url.port = String(port);
    return url.toString().replace(/\/$/u, "");
  } catch {
    return endpoint.httpBaseUrl;
  }
}

export function isWslSettingsRowVisible(input: {
  readonly state: DesktopWslState | null;
  readonly error: string | null;
}): boolean {
  const { state, error } = input;
  return state ? state.available || state.enabled || state.wslOnly : error !== null;
}

/**
 * Once client/server versions match, this passive Version label follows the sidebar update action,
 * including retryable failures. Rechecks retain downloaded-update labels; `state` is null outside desktop.
 */
export function resolveLocalVersionStatusLabel(
  state: DesktopUpdateState | null,
  resolve: MessageResolver = m,
): string {
  if (!state) return resolve(msg("Up to date"));
  if (state.status === "downloading") {
    return state.availableVersion
      ? resolve(msg("Downloading update {version}", { version: state.availableVersion }))
      : resolve(msg("Downloading update"));
  }
  const action = resolveDesktopUpdateButtonAction(state);
  if (
    action === "install" ||
    state.status === "downloaded" ||
    (state.status === "checking" && state.downloadedVersion !== null)
  ) {
    const version = getDesktopUpdateDownloadedVersion(state);
    return version
      ? resolve(msg("Update {version} downloaded", { version }))
      : resolve(msg("Update downloaded"));
  }
  if (action === "download") {
    return state.availableVersion
      ? resolve(msg("Update {version} available", { version: state.availableVersion }))
      : resolve(msg("Update available"));
  }
  return resolve(msg("Up to date"));
}

export type QrEndpointOption = {
  readonly id: string;
  /** Stable per endpoint type, not unique; used only to match the saved default. */
  readonly preferenceKey: string;
  readonly qrShareable: boolean;
};

export function selectQrEndpointOption<T extends QrEndpointOption>(
  options: ReadonlyArray<T>,
  selectedId: string | null,
  defaultPreferenceKey: string | null,
): T | null {
  return (
    (selectedId !== null ? options.find((option) => option.id === selectedId) : undefined) ??
    (defaultPreferenceKey !== null
      ? options.find((option) => option.preferenceKey === defaultPreferenceKey)
      : undefined) ??
    options.find((option) => option.qrShareable) ??
    options[0] ??
    null
  );
}

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage preferences before enabling; only the final call should relaunch WSL with the complete selection.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}

export function resolveCurrentOriginPairingUrl(
  credential: string,
  currentHref: string = window.location.href,
): string | null {
  const url = new URL("/pair", currentHref);
  // The packaged desktop window loads from t3code://app, which no other device can open.
  if ((url.protocol !== "http:" && url.protocol !== "https:") || isLoopbackHostname(url.hostname)) {
    return null;
  }
  return setPairingTokenOnUrl(url, credential).toString();
}

const accessTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAccessTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return accessTimestampFormatter.format(parsed);
}

export function parseManualDesktopSshTarget(
  input: {
    readonly host: string;
    readonly username: string;
    readonly port: string;
  },
  resolve: MessageResolver = m,
): DesktopSshEnvironmentTarget {
  const rawHost = input.host.trim();
  if (rawHost.length === 0) {
    throw new Error(resolve(msg("SSH host or alias is required.")));
  }

  let hostname = rawHost;
  let username = input.username.trim() || null;
  let port: number | null = null;

  const atIndex = hostname.lastIndexOf("@");
  if (atIndex > 0) {
    const inlineUsername = hostname.slice(0, atIndex).trim();
    hostname = hostname.slice(atIndex + 1).trim();
    if (!username && inlineUsername.length > 0) {
      username = inlineUsername;
    }
  }

  const bracketedHostMatch = /^\[([^\]]+)\](?::(\d+))?$/u.exec(hostname);
  if (bracketedHostMatch) {
    hostname = bracketedHostMatch[1]!.trim();
    if (bracketedHostMatch[2]) {
      port = Number.parseInt(bracketedHostMatch[2], 10);
    }
  } else {
    const colonSegments = hostname.split(":");
    if (colonSegments.length === 2 && /^\d+$/u.test(colonSegments[1] ?? "")) {
      hostname = colonSegments[0]!.trim();
      port = Number.parseInt(colonSegments[1]!, 10);
    }
  }

  const rawPort = input.port.trim();
  if (rawPort.length > 0) {
    port = /^\d+$/u.test(rawPort) ? Number.parseInt(rawPort, 10) : Number.NaN;
  }

  if (hostname.length === 0) {
    throw new Error(resolve(msg("SSH host or alias is required.")));
  }

  if (port !== null && (!Number.isInteger(port) || port <= 0 || port > 65_535)) {
    throw new Error(resolve(msg("SSH port must be between 1 and 65535.")));
  }

  return {
    alias: hostname,
    hostname,
    username,
    port,
  };
}

/** A loopback server advertises a direct endpoint only once its Tailscale Serve URL answers. */
export function isServerNetworkAccessible(input: {
  readonly authPolicy: ServerAuthPolicy | null;
  readonly directEndpoints: ReadonlyArray<ServerDirectEndpoint> | undefined;
}): boolean {
  if (input.authPolicy === "remote-reachable") return true;
  return input.authPolicy === "loopback-browser" && (input.directEndpoints?.length ?? 0) > 0;
}

/** An explicit choice while it is listed, else the primary, else a connected environment. */
export function resolveAccessEnvironmentId(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly connected: boolean;
  }>;
  readonly selected: EnvironmentId | null;
}): EnvironmentId | null {
  const isListed = (environmentId: EnvironmentId | null) =>
    input.environments.some((environment) => environment.environmentId === environmentId);
  if (isListed(input.selected)) return input.selected;
  if (isListed(input.primaryEnvironmentId)) return input.primaryEnvironmentId;
  return (
    (input.environments.find((environment) => environment.connected) ?? input.environments[0])
      ?.environmentId ?? null
  );
}

/** A short name for a T3 Connect device: its label, or what it runs on. */
export function connectDeviceName(
  {
    client,
  }: {
    readonly client?: AuthClientMetadata | undefined;
  },
  resolve: MessageResolver = m,
): string {
  return client?.label ?? client?.os ?? client?.browser ?? resolve(msg("this device"));
}

/** How a T3 Connect device describes itself. It can say anything, so the code is what to trust. */
export function describeConnectDeviceClient(
  {
    client,
  }: {
    readonly client?: AuthClientMetadata | undefined;
  },
  resolve: MessageResolver = m,
): string {
  const bits = [client?.label, client?.os, client?.browser, client?.ipAddress].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return bits.length > 0 ? [...new Set(bits)].join(" · ") : resolve(msg("Unknown device"));
}

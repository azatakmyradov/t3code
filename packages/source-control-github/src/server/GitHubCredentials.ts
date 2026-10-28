import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { readSourceControlHostSettings } from "@t3tools/source-control-core/shared/definition";
import type { ServerSettings } from "@t3tools/contracts";

import * as GitHubClient from "../shared/definition.ts";

/**
 * Every gh run on the server shares this. A burst of them (a status poll across many checkouts)
 * otherwise starts enough at once to trip GitHub's secondary rate limit.
 */
export const GH_PROCESS_CONCURRENCY = { key: "gh", limit: 4 } as const;

const TOKEN_TTL = Duration.minutes(5);
const MISSING_TTL = Duration.seconds(10);

const CredentialCacheKey = Schema.fromJsonString(
  Schema.Struct({
    host: Schema.String,
    account: Schema.NullOr(Schema.String),
    cwd: Schema.NullOr(Schema.String),
  }),
);
const encodeCacheKey = Schema.encodeSync(CredentialCacheKey);
const decodeCacheKey = Schema.decodeUnknownSync(CredentialCacheKey);

export const GitHubCredentialSource = Schema.Literals(["settings", "env", "gh"]);
export type GitHubCredentialSource = typeof GitHubCredentialSource.Type;

/** The checkout whose CLI wrapper/environment determines the unpinned account. */
export interface GitHubCredentialContext {
  readonly cwd: string;
}

export interface GitHubCredential {
  readonly host: string;
  readonly token: Redacted.Redacted<string>;
  readonly source: GitHubCredentialSource;
  readonly fingerprint: string;
}

export class GitHubCliMissingError extends Schema.TaggedError<GitHubCliMissingError>()(
  "GitHubCliMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return `No GitHub credential for ${this.host}: set GH_TOKEN, or install the GitHub CLI and run \`gh auth login\`.`;
  }
}

export class GitHubNotSignedInError extends Schema.TaggedError<GitHubNotSignedInError>()(
  "GitHubNotSignedInError",
  { host: Schema.String, account: Schema.optional(Schema.String) },
) {
  override get message(): string {
    return this.account === undefined
      ? `No GitHub credential for ${this.host}: run \`gh auth login --hostname ${this.host}\`.`
      : `No GitHub credential for ${this.account} on ${this.host}: run \`gh auth login --hostname ${this.host}\` for that account or pick another in Settings → Source Control.`;
  }
}

export class GitHubHostDisabledError extends Schema.TaggedError<GitHubHostDisabledError>()(
  "GitHubHostDisabledError",
  { host: Schema.String },
) {
  override get message(): string {
    return `GitHub host ${this.host} is turned off in Settings → Source Control.`;
  }
}

export class GitHubCliFailedError extends Schema.TaggedError<GitHubCliFailedError>()(
  "GitHubCliFailedError",
  { host: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The GitHub CLI could not hand over a credential for ${this.host}. Check \`gh auth status\` on the server.`;
  }
}

export class GitHubAccountResolutionError extends Schema.TaggedError<GitHubAccountResolutionError>()(
  "GitHubAccountResolutionError",
  { host: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not verify the GitHub account for this repository on ${this.host}. Check GitHub CLI authentication from the repository directory, or choose an account in Settings → Source Control.`;
  }
}

/** There is no token for the host. */
export type GitHubCredentialUnavailableError =
  | GitHubCliMissingError
  | GitHubNotSignedInError
  | GitHubHostDisabledError
  | GitHubCliFailedError
  | GitHubAccountResolutionError;

export class GitHubCredentials extends Context.Service<
  GitHubCredentials,
  {
    readonly get: (
      host: string,
      context?: GitHubCredentialContext,
    ) => Effect.Effect<GitHubCredential, GitHubCredentialUnavailableError>;
    readonly invalidate: (host: string) => Effect.Effect<void>;
  }
>()("@t3tools/source-control-github/server/GitHubCredentials") {}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

const HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

/** API URLs are built from the host text, so anything but a bare hostname could redirect a token. */
export function isGitHubHost(host: string): boolean {
  return HOSTNAME.test(host);
}

function isGitHubDotCom(host: string): boolean {
  return host === "github.com" || host.endsWith(".ghe.com");
}

/** Restrict GH_ENTERPRISE_TOKEN to GH_HOST to prevent remote URLs from leaking it. */
export function environmentToken(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (!isGitHubHost(host)) return null;
  const names = isGitHubDotCom(host)
    ? ["GH_TOKEN", "GITHUB_TOKEN"]
    : env.GH_HOST?.trim().toLowerCase() === host
      ? ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]
      : [];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/** @public */
export const make = Effect.gen(function* () {
  const sourceControlHost = yield* SourceControlHost.SourceControlHost;
  const process = sourceControlHost.process;
  const crypto = yield* Crypto.Crypto;
  const environment = yield* HostProcess.Environment;
  const workingDirectory = yield* HostProcess.WorkingDirectory;

  const fingerprintOf = (host: string, token: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(token)).pipe(
      Effect.map((digest) => `${host}:${Hex.encode(digest)}`),
      Effect.orDie,
    );

  // Environment credentials are resolved above the CLI with host guards. Do not let gh's
  // broader enterprise-token fallback send an ambient token to a remote-selected host.
  const cliEnvironment = {
    GH_DEBUG: "",
    GH_PROMPT_DISABLED: "1",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GH_ENTERPRISE_TOKEN: "",
    GITHUB_ENTERPRISE_TOKEN: "",
  };

  const fromGh = (host: string, account: string | undefined, cwd = workingDirectory) =>
    process
      .run({
        operation: "GitHubCredentials.get",
        command: "gh",
        args: [
          "auth",
          "token",
          "--hostname",
          host,
          ...(account === undefined ? [] : ["--user", account]),
        ],
        cwd,
        // Never let gh print the token into a debug log.
        env: cliEnvironment,
        timeoutMs: 10_000,
        concurrency: GH_PROCESS_CONCURRENCY,
      })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "VcsProcessSpawnError" &&
          error.cause instanceof PlatformError.PlatformError &&
          error.cause.reason._tag === "NotFound"
            ? new GitHubCliMissingError({ host })
            : // gh exits non-zero with "no oauth token" when it has no login for the host.
              error._tag === "VcsProcessExitError"
              ? new GitHubNotSignedInError({ host, ...(account === undefined ? {} : { account }) })
              : new GitHubCliFailedError({ host, cause: error }),
        ),
        Effect.map((output) => output.stdout.trim()),
        Effect.filterOrFail(
          (token) => token !== "",
          () => new GitHubNotSignedInError({ host, ...(account === undefined ? {} : { account }) }),
        ),
      );

  const readSettings = (settings: ServerSettings) =>
    readSourceControlHostSettings(
      GitHubClient.settings,
      settings.sourceControlHosts[GitHubClient.definition.kind],
    );

  const hostChoice = (host: string) =>
    sourceControlHost.settings.get.pipe(
      Effect.map((settings) => readSettings(settings).hosts[host]),
      Effect.mapError((cause) => new GitHubAccountResolutionError({ host, cause })),
    );

  const savedToken = (host: string) =>
    sourceControlHost.settings.get.pipe(
      Effect.map((settings) => readSettings(settings).tokens[host]?.trim() || null),
      Effect.mapError((cause) => new GitHubAccountResolutionError({ host, cause })),
    );

  // CLI wrappers may route non-auth commands by working directory while forwarding auth
  // commands unchanged. Resolve identity first, then request that exact stored login.
  const repositoryAccount = Effect.fn("GitHubCredentials.repositoryAccount")(function* (
    host: string,
    cwd: string,
  ) {
    const result = yield* process
      .run({
        operation: "GitHubCredentials.repositoryAccount",
        command: "gh",
        args: ["api", "--hostname", host, "user", "--jq", ".login"],
        cwd,
        env: cliEnvironment,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "VcsProcessSpawnError" &&
          cause.cause instanceof PlatformError.PlatformError &&
          cause.cause.reason._tag === "NotFound"
            ? new GitHubCliMissingError({ host })
            : new GitHubAccountResolutionError({ host, cause }),
        ),
      );
    const account = result.stdout.trim();
    if (
      result.exitCode !== 0 ||
      result.stdoutTruncated ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(account)
    ) {
      return yield* new GitHubAccountResolutionError({
        host,
        cause: new Error("Invalid GitHub login response."),
      });
    }
    return account;
  });

  /** Account and checkout scope are part of the cache key; concurrent projects never share selection. */
  const cacheKey = (host: string, account: string | undefined, cwd: string | undefined) =>
    encodeCacheKey({ host, account: account ?? null, cwd: cwd ?? null });

  const lookup = Effect.fn("GitHubCredentials.lookup")(function* (key: string) {
    const { host, account, cwd: directory } = decodeCacheKey(key);
    const cwd = directory ?? workingDirectory;
    // An environment token wins over a pinned account, exactly as it does in gh.
    const fromEnv = environmentToken(host, environment);
    // A selected login never falls back to another account.
    const choice =
      account ??
      (fromEnv === null && directory !== null ? yield* repositoryAccount(host, cwd) : undefined);
    const token = fromEnv ?? (yield* fromGh(host, choice, cwd));
    return {
      host,
      token: Redacted.make(token),
      source: fromEnv !== null ? "env" : "gh",
      fingerprint: yield* fingerprintOf(host, token),
    } satisfies GitHubCredential;
  });

  const cache = yield* Cache.makeWith(lookup, {
    // A server can hold many worktrees on one host, each with its own CLI account selection.
    capacity: 128,
    // A transient gh failure (a timeout, a locked keyring) is asked again on the next read.
    timeToLive: (exit) =>
      Exit.isSuccess(exit)
        ? TOKEN_TTL
        : Exit.findErrorOption(exit).pipe(
              Option.exists(
                (error) =>
                  error._tag === "GitHubCliFailedError" ||
                  error._tag === "GitHubAccountResolutionError",
              ),
            )
          ? Duration.zero
          : MISSING_TTL,
  });

  return GitHubCredentials.of({
    get: Effect.fn("GitHubCredentials.get")(function* (rawHost, context) {
      const host = normalizeHost(rawHost);
      if (!isGitHubHost(host)) return yield* new GitHubNotSignedInError({ host });
      const choice = yield* hostChoice(host);
      if (choice?.enabled === false) {
        return yield* new GitHubHostDisabledError({ host });
      }
      const saved = yield* savedToken(host);
      if (saved !== null) {
        return {
          host,
          token: Redacted.make(saved),
          source: "settings",
          fingerprint: yield* fingerprintOf(host, saved),
        } satisfies GitHubCredential;
      }
      return yield* Cache.get(cache, cacheKey(host, choice?.account, context?.cwd));
    }),
    // A refused credential can be held by several checkouts on the same host.
    invalidate: Effect.fn("GitHubCredentials.invalidate")(() => Cache.invalidateAll(cache)),
  });
});

export const layer = Layer.effect(GitHubCredentials, make);

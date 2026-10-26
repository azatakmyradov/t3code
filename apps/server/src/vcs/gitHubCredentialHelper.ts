import * as Effect from "effect/Effect";

/** Git supplies the credential request on stdin; the token never enters argv or config. */
const ACCOUNT_HELPER = `!f() {
  test "$2" = get || return 0
  protocol= host= path= username=
  while IFS= read -r line && test -n "$line"; do
    case "$line" in
      protocol=*) protocol=\${line#protocol=} ;;
      host=*) host=\${line#host=} ;;
      path=*) path=\${line#path=} ;;
      username=*) username=\${line#username=} ;;
    esac
  done
  test "$protocol" = https && test -n "$username" || return 0
  host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
  case "$host" in *:443) host=\${host%:443} ;; esac
  index=0
  printf '%s\\n' "$T3_GIT_GITHUB_ACCOUNTS" |
    while IFS="$(printf '\\t')" read -r target_host target_path account executable; do
      index=$((index + 1))
      test "$index" = "$1" || continue
      target_path=\${target_path#path=}
      test "$host" = "$target_host" && test "$path" = "$target_path" && test "$username" = "$account" || continue
      token=$("$executable" auth token --hostname "$host" --user "$account" 2>/dev/null) && test -n "$token" || {
        printf 'fatal: Authentication failed for the selected GitHub account.\\n' >&2
        printf 'quit=true\\n'
        exit 0
      }
      printf 'username=%s\\npassword=%s\\n' "$account" "$token"
      exit 0
    done
}; f`;

function decodedUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

interface GitReadResult {
  readonly exitCode: number;
  readonly stdout: string;
}

type GitRead = (args: ReadonlyArray<string>) => Effect.Effect<GitReadResult>;

/** Recognize gh's own setup-git helper, without interpreting arbitrary shell commands. */
function ghExecutable(helper: string): string | null {
  const match =
    /^!\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s'";&|<>`$]+))\s+auth\s+git-credential\s*$/u.exec(
      helper,
    );
  const executable = match?.[1] ?? match?.[2] ?? match?.[3];
  return executable !== undefined &&
    !/[$`]/u.test(executable) &&
    /(?:^|[/\\])gh(?:\.exe)?$/iu.test(executable)
    ? executable
    : null;
}

/** Keep Git's directory/config options when looking up this invocation's transport settings. */
function transportCommand(args: ReadonlyArray<string>) {
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(arg)) {
      if (args[index + 1] === undefined) return null;
      index += 2;
    } else if (/^--(?:git-dir|work-tree|namespace|config-env)=/u.test(arg)) {
      index += 1;
    } else if (["--bare", "--no-pager", "--no-optional-locks"].includes(arg)) {
      index += 1;
    } else {
      break;
    }
  }
  const command = args[index];
  if (!["fetch", "pull", "push", "clone", "ls-remote"].includes(command ?? "")) return null;
  const prefix = args.slice(0, index);
  const valueOptions = new Set([
    "--depth",
    "--deepen",
    "--shallow-since",
    "--shallow-exclude",
    "--upload-pack",
    "--receive-pack",
    "--exec",
    "--repo",
    "--filter",
    "--jobs",
    "-j",
    "--server-option",
    "-o",
    "--branch",
    "-b",
    "--origin",
    "--separate-git-dir",
    "--reference",
    "--reference-if-able",
    "--template",
    "--config",
    "-c",
  ]);
  for (index += 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") return { prefix, command: command!, remote: args[index + 1] ?? null };
    if (arg === "--all" || arg === "--multiple") return null;
    if (valueOptions.has(arg)) {
      if (arg === "--repo") return { prefix, command: command!, remote: args[index + 1] ?? null };
      index += 1;
    } else if (arg.startsWith("--repo=")) {
      return { prefix, command: command!, remote: arg.slice("--repo=".length) };
    } else if (!arg.startsWith("-")) {
      return { prefix, command: command!, remote: arg };
    }
  }
  return { prefix, command: command!, remote: null };
}

/**
 * Adds a read-only fallback after the configured helpers. gh's helper declines a requested
 * username when another account is active; asking for that user's token avoids changing gh's
 * global active account. Other helpers, SSH, and gh's environment-token precedence stay native.
 */
export const gitHubCredentialFallback = Effect.fnUntraced(function* (
  args: ReadonlyArray<string>,
  read: GitRead,
) {
  const command = transportCommand(args);
  if (command === null) return null;
  const gitRead = (tail: ReadonlyArray<string>) => read([...command.prefix, ...tail]);
  const config = (key: string) =>
    gitRead(["config", "--get", key]).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")),
    );
  let remote = command.remote;
  if (remote === null && command.command !== "clone") {
    const branch = yield* gitRead(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const branchName = branch.exitCode === 0 ? branch.stdout.trim() : "";
    if (command.command === "push") {
      remote =
        (branchName && (yield* config(`branch.${branchName}.pushRemote`))) ||
        (yield* config("remote.pushDefault")) ||
        null;
    }
    remote ??= (branchName && (yield* config(`branch.${branchName}.remote`))) || "origin";
  }
  if (!remote) return null;
  const resolved =
    command.command === "clone"
      ? { exitCode: 0, stdout: remote }
      : yield* gitRead([
          "remote",
          "get-url",
          ...(command.command === "push" ? ["--push"] : []),
          "--all",
          remote,
        ]);
  const urls = resolved.exitCode === 0 ? resolved.stdout.trim().split("\n") : [remote];
  const helperConfig = yield* gitRead([
    "config",
    "--null",
    "--get-regexp",
    "^credential(\\..*)?\\.helper$",
  ]);
  if (helperConfig.exitCode !== 0) return null;
  const records = helperConfig.stdout.split("\0").flatMap((record) => {
    const separator = record.indexOf("\n");
    return separator < 0
      ? []
      : [{ key: record.slice(0, separator), value: record.slice(separator + 1) }];
  });
  const configArgs: string[] = [];
  const accounts: string[] = [];
  for (const raw of urls) {
    const url = URL.parse(raw);
    if (!url || url.protocol !== "https:" || url.password) continue;
    let username = decodedUriComponent(url.username);
    if (username === null) continue;
    if (!username) {
      const configured = yield* gitRead([
        "config",
        "--get-urlmatch",
        "credential.username",
        url.href,
      ]);
      username = configured.exitCode === 0 ? configured.stdout.trim() : "";
    }
    if (!username || /[\r\n\t]/u.test(username)) continue;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const target = url.href;
    // Git combines matching helpers, including resets. Ask Git itself whether each URL scope
    // matches rather than duplicating its wildcard, username, port, and path matching rules.
    let executable: string | null = null;
    for (const record of records) {
      if (record.key !== "credential.helper") {
        const scope = record.key.slice("credential.".length, -".helper".length);
        const matches = yield* gitRead([
          "-c",
          `credential.${scope}.t3FallbackMatch=1`,
          "config",
          "--get-urlmatch",
          "credential.t3FallbackMatch",
          raw,
        ]);
        if (matches.exitCode !== 0 || matches.stdout.trim() !== "1") continue;
      }
      if (record.value === "") executable = null;
      else executable ??= ghExecutable(record.value);
    }
    if (executable === null || /[\r\n\t]/u.test(executable)) continue;
    let credentialPath = decodedUriComponent(url.pathname.slice(1));
    if (credentialPath === null) continue;
    if (/[\r\n\t]/u.test(credentialPath)) continue;
    const useHttpPath = yield* gitRead([
      "config",
      "--type=bool",
      "--get-urlmatch",
      "credential.useHttpPath",
      raw,
    ]);
    if (useHttpPath.exitCode !== 0 || useHttpPath.stdout.trim() !== "true") credentialPath = "";
    accounts.push([url.host, `path=${credentialPath}`, username, executable].join("\t"));
    configArgs.push("-c", `credential.${target}.helper=${ACCOUNT_HELPER} ${accounts.length}`);
  }
  return accounts.length === 0
    ? null
    : {
        args: [...command.prefix, ...configArgs, ...args.slice(command.prefix.length)],
        env: { T3_GIT_GITHUB_ACCOUNTS: accounts.join("\n") },
      };
});

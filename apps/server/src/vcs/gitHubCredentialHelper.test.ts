import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";
import { gitHubCredentialFallback } from "./gitHubCredentialHelper.ts";

const layer = VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer));
const repositoryUrl = "https://github.com/acme/project.git";

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const processRunner = yield* VcsProcess.VcsProcess;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-github-helper-" });
  const executable = `${cwd}/fake bin/gh`;
  yield* fs.makeDirectory(`${cwd}/fake bin`);
  yield* fs.writeFileString(`${cwd}/empty-config`, "");
  yield* fs.writeFileString(
    executable,
    `#!/bin/sh
case "$1 $2" in
  'auth git-credential')
    test "$3" = get || exit 0
    username=
    while IFS= read -r line && test -n "$line"; do
      case "$line" in username=*) username=\${line#username=} ;; esac
    done
    if test -n "$GH_TOKEN"; then
      printf 'username=x-access-token\\npassword=%s\\n' "$GH_TOKEN"
    elif test -z "$username" || test "$username" = personal; then
      printf 'username=personal\\npassword=personal-fixture\\n'
    fi
    ;;
  'auth token')
    printf '%s\\n' "$*" >> "$T3_HELPER_CALL_LOG"
    test "$3" = --hostname && test "$4" = github.com && test "$5" = --user || exit 1
    case "$6" in
      work|personal) printf '%s-fixture\\n' "$6" ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
`,
  );
  yield* fs.chmod(executable, 0o755);
  const env = {
    HOME: cwd,
    XDG_CONFIG_HOME: cwd,
    GIT_CONFIG_GLOBAL: `${cwd}/empty-config`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    T3_HELPER_CALL_LOG: `${cwd}/calls`,
  };
  const run = (args: ReadonlyArray<string>, stdin?: string, extraEnv?: NodeJS.ProcessEnv) =>
    processRunner.run({
      operation: "credentialHelper.test",
      command: "git",
      cwd,
      args,
      env: { ...env, ...extraEnv },
      ...(stdin === undefined ? {} : { stdin }),
      allowNonZeroExit: true,
    });
  const configure = (key: string, value: string) => run(["config", "--add", key, value]);
  yield* run(["init", "--quiet"]);
  yield* run(["remote", "add", "origin", repositoryUrl]);
  yield* configure("credential.https://github.com.helper", `!"${executable}" auth git-credential`);
  yield* configure(`credential.${repositoryUrl}.username`, "work");
  const resolve = (args: ReadonlyArray<string> = ["push", "origin", "HEAD"]) =>
    gitHubCredentialFallback(args, (readArgs) => run(readArgs).pipe(Effect.orDie));
  const fill = (
    fallback: NonNullable<Effect.Success<ReturnType<typeof resolve>>>,
    args: ReadonlyArray<string> = ["push", "origin", "HEAD"],
    url = repositoryUrl,
    extraEnv?: NodeJS.ProcessEnv,
  ) =>
    run(
      [
        ...fallback.args.slice(
          0,
          -args.length +
            args.findIndex((arg) => ["push", "pull", "fetch", "clone", "ls-remote"].includes(arg)),
        ),
        "credential",
        "fill",
      ],
      `url=${url}\n\n`,
      {
        ...fallback.env,
        ...extraEnv,
      },
    );
  return { cwd, fs, env, configure, run, resolve, fill };
});

it.effect("applies account routing to a real Git subprocess without network access", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const remoteHelper = `${fixture.cwd}/fake bin/git-remote-https`;
    yield* fixture.fs.writeFileString(
      remoteHelper,
      `#!/bin/sh
printf 'url=%s\\n\\n' "$2" | git credential fill > "$T3_REMOTE_CREDENTIAL_LOG" || exit 1
while IFS= read -r line; do
  case "$line" in capabilities|list*) printf '\\n' ;; esac
done
`,
    );
    yield* fixture.fs.chmod(remoteHelper, 0o755);
    const result = yield* driver.execute({
      operation: "GitVcsDriver.test.selectedGitHubAccount",
      cwd: fixture.cwd,
      args: ["ls-remote", "origin"],
      env: {
        ...fixture.env,
        GIT_EXEC_PATH: `${fixture.cwd}/fake bin`,
        T3_REMOTE_CREDENTIAL_LOG: `${fixture.cwd}/credentials`,
      },
      timeoutMs: 10_000,
    });
    assert.equal(result.exitCode, 0);
    assert.include(
      yield* fixture.fs.readFileString(`${fixture.cwd}/credentials`),
      "password=work-fixture",
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        VcsProcess.layer,
        GitVcsDriver.layer.pipe(
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-github-helper-core-" }),
          ),
        ),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  ),
);

it.layer(layer)("GitHub Git credential fallback", (it) => {
  it.effect("uses the selected inactive account without changing the active account", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const before = yield* fixture.run(["config", "--list", "--local"]);
      const fallback = yield* fixture.resolve();
      assert.isNotNull(fallback);
      const result = yield* fixture.fill(fallback!);
      assert.equal(result.exitCode, 0);
      assert.include(result.stdout, "username=work\npassword=work-fixture");
      assert.equal(
        (yield* fixture.fs.readFileString(`${fixture.cwd}/calls`)).trim(),
        "auth token --hostname github.com --user work",
      );
      assert.equal((yield* fixture.run(["config", "--list", "--local"])).stdout, before.stdout);
      assert.notInclude(fallback!.args.join(" "), "work-fixture");
    }),
  );

  it.effect("preserves native environment-token precedence and other credential helpers", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const fallback = yield* fixture.resolve();
      assert.isNotNull(fallback);
      const environment = yield* fixture.fill(fallback!, undefined, undefined, {
        GH_TOKEN: "environment-fixture",
      });
      assert.include(environment.stdout, "password=environment-fixture");
      assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/calls`));
      yield* fixture.configure(
        "credential.helper",
        "!f() { printf 'username=work\\npassword=custom-fixture\\n'; }; f",
      );
      const custom = yield* fixture.resolve();
      const result = yield* fixture.fill(custom!);
      assert.include(result.stdout, "password=custom-fixture");
      assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/calls`));
    }),
  );

  it.effect("fails closed if the chosen account is missing", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* fixture.run(["config", `credential.${repositoryUrl}.username`, "missing"]);
      const fallback = yield* fixture.resolve();
      const result = yield* fixture.fill(fallback!);
      assert.notEqual(result.exitCode, 0);
      assert.notInclude(result.stdout, "personal-fixture");
      assert.include(result.stderr, "Authentication failed for the selected GitHub account");
    }),
  );

  it.effect("preserves path handling for existing helpers and uses a configured path", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* fixture.configure("credential.helper", '!f() { cat >> "$T3_HELPER_PATH_LOG"; }; f');
      const log = `${fixture.cwd}/request`;
      const fallback = yield* fixture.resolve();
      assert.equal(
        (yield* fixture.fill(fallback!, undefined, undefined, { T3_HELPER_PATH_LOG: log }))
          .exitCode,
        0,
      );
      assert.notInclude(yield* fixture.fs.readFileString(log), "path=");
      yield* fixture.configure(`credential.${repositoryUrl}.useHttpPath`, "true");
      const withPath = yield* fixture.resolve();
      assert.include(withPath!.env.T3_GIT_GITHUB_ACCOUNTS, "path=acme/project.git");
      assert.equal(
        (yield* fixture.fill(withPath!, undefined, undefined, { T3_HELPER_PATH_LOG: log }))
          .exitCode,
        0,
      );
      assert.include(yield* fixture.fs.readFileString(log), "path=acme/project.git");
    }),
  );

  it.effect("ignores malformed URL usernames and helpers with shell expansions", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* fixture.run([
        "remote",
        "set-url",
        "origin",
        "https://bad%FF@github.com/acme/project.git",
      ]);
      assert.isNull(yield* fixture.resolve());
      yield* fixture.run(["remote", "set-url", "origin", repositoryUrl]);
      yield* fixture.run([
        "config",
        "credential.https://github.com.helper",
        '!"$HOME/gh" auth git-credential',
      ]);
      assert.isNull(yield* fixture.resolve());
    }),
  );

  it.effect("accepts Git's original host casing and explicit default HTTPS port", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      for (const url of [
        "https://work@GitHub.Com/acme/project.git",
        "https://work@github.com:443/acme/project.git",
      ]) {
        yield* fixture.run(["remote", "set-url", "origin", url]);
        const fallback = yield* fixture.resolve();
        assert.equal((yield* fixture.fill(fallback!, undefined, url)).exitCode, 0);
      }
    }),
  );

  it.effect("appends after invocation-local helper resets", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const args = [
        "-c",
        "credential.helper=",
        "-c",
        `credential.helper=!"${fixture.cwd}/fake bin/gh" auth git-credential`,
        "push",
        "origin",
        "HEAD",
      ];
      const fallback = yield* fixture.resolve(args);
      const result = yield* fixture.fill(fallback!, args);
      assert.equal(result.exitCode, 0);
      assert.include(result.stdout, "password=work-fixture");
    }),
  );

  it.effect("does not run the fallback for a different host or repository", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const fallback = yield* fixture.resolve();
      for (const url of [
        "https://work@github.com/other/project.git",
        "https://work@example.com/acme/project.git",
      ]) {
        const result = yield* fixture.fill(fallback!, undefined, url);
        assert.notEqual(result.exitCode, 0);
      }
      assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/calls`));
    }),
  );

  it.effect("leaves SSH, repositories without a username, and non-gh helpers alone", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* fixture.run(["remote", "set-url", "origin", "git@github-work:acme/project.git"]);
      assert.isNull(yield* fixture.resolve());
      yield* fixture.run(["remote", "set-url", "origin", repositoryUrl]);
      yield* fixture.run(["config", "--unset", `credential.${repositoryUrl}.username`]);
      assert.isNull(yield* fixture.resolve());
      yield* fixture.configure(`credential.${repositoryUrl}.username`, "work");
      yield* fixture.run(["config", "credential.https://github.com.helper", "manager"]);
      assert.isNull(yield* fixture.resolve());
    }),
  );

  it.effect("honors helper resets and ignores gh helpers on other hosts", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* fixture.configure(`credential.${repositoryUrl}.helper`, "");
      yield* fixture.configure(`credential.${repositoryUrl}.helper`, "manager");
      assert.isNull(yield* fixture.resolve());
      yield* fixture.run(["config", "--unset-all", `credential.${repositoryUrl}.helper`]);
      yield* fixture.run([
        "remote",
        "set-url",
        "origin",
        "https://work@example.com/acme/project.git",
      ]);
      assert.isNull(yield* fixture.resolve());
    }),
  );

  it.effect("follows push URLs and preserves -C and --git-dir lookup contexts", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* fixture.run([
        "remote",
        "set-url",
        "--push",
        "origin",
        "https://personal@github.com/me/project.git",
      ]);
      const push = yield* fixture.resolve();
      assert.include(push!.env.T3_GIT_GITHUB_ACCOUNTS, "github.com\tpath=\tpersonal\t");
      for (const args of [
        ["-C", fixture.cwd, "pull", "--ff-only"],
        ["--git-dir", `${fixture.cwd}/.git`, "fetch", "origin"],
      ]) {
        const fallback = yield* fixture.resolve(args);
        assert.isNotNull(fallback);
        assert.include(fallback!.env.T3_GIT_GITHUB_ACCOUNTS, "github.com\tpath=\twork\t");
      }
    }),
  );

  it.effect("adds no configuration reads to local git commands", () =>
    Effect.gen(function* () {
      let reads = 0;
      const result = yield* gitHubCredentialFallback(["status", "--porcelain"], () => {
        reads += 1;
        return Effect.succeed({ exitCode: 0, stdout: "" });
      });
      assert.isNull(result);
      assert.equal(reads, 0);
    }),
  );
});

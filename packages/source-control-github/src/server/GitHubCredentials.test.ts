import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import type * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as GitHubCredentials from "./GitHubCredentials.ts";

const TOKEN_VARIABLES = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
] as const;

const hostSettings = (
  hosts: Record<string, { readonly account?: string; readonly enabled?: boolean }>,
) =>
  Object.fromEntries(
    Object.entries(hosts).map(([host, choice]) => [host, { enabled: true, ...choice }]),
  );

function harness(
  hosts: Record<string, { readonly account?: string; readonly enabled?: boolean }> = {},
  signedOut: ReadonlyArray<string> = [],
  tokens: Record<string, string> = {},
  repositoryAccounts: Record<string, string> = {},
) {
  const calls: Array<ReadonlyArray<string>> = [];
  const invocations: Array<SourceControlHost.SourceControlProcessInput> = [];
  const run: SourceControlHost.SourceControlHost["Service"]["process"]["run"] = (input) =>
    Effect.sync(() => {
      calls.push(input.args);
      invocations.push(input);
      if (input.args[0] === "api")
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: repositoryAccounts[input.cwd] ?? "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      const user = input.args[input.args.indexOf("--user") + 1];
      if (input.args.includes("--user") && user !== undefined && signedOut.includes(user)) {
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }
      return {
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout: input.args.includes("--user") ? `token-for-${user}\n` : "active-token\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });
  const layer = GitHubCredentials.layer.pipe(
    Layer.provideMerge(
      TestSourceControlHost.layer({
        settings: applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
          sourceControlHosts: { github: { hosts: hostSettings(hosts), tokens } },
        }),
        process: { run },
      }),
    ),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => Effect.die(`Unexpected request to ${request.url}`)),
      ),
    ),
  );
  return { layer, calls, invocations };
}

describe("GitHubCredentials", () => {
  beforeEach(() => {
    for (const name of TOKEN_VARIABLES) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.effect("lets an environment token win over a pinned account, as gh does", () => {
    vi.stubEnv("GH_TOKEN", "from-env");
    const { layer, calls } = harness({ "github.com": { account: "work" } });
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const credential = yield* credentials.get("github.com");
      expect(Redacted.value(credential.token)).toBe("from-env");
      expect(credential.source).toBe("env");
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("picks up a changed account on the next request without a restart", () => {
    const { layer, calls } = harness();
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const settings = yield* TestSourceControlHost.TestSourceControlHostSettings;
      expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("active-token");

      yield* settings.update({
        sourceControlHosts: {
          github: { hosts: { "github.com": { account: "work", enabled: true } } },
        },
      });
      expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("token-for-work");

      yield* settings.update({
        sourceControlHosts: { github: { hosts: { "github.com": { enabled: false } } } },
      });
      expect((yield* Effect.flip(credentials.get("github.com")))._tag).toBe(
        "GitHubHostDisabledError",
      );

      yield* settings.update({ sourceControlHosts: { github: { hosts: {} } } });
      expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("active-token");
      expect(calls).toHaveLength(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails closed when the pinned login is no longer signed in", () => {
    const { layer, calls } = harness({ "github.com": { account: "gone" } }, ["gone"]);
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const error = yield* Effect.flip(credentials.get("github.com"));
      expect(error._tag).toBe("GitHubNotSignedInError");
      expect(error.message).toContain("gone");
      expect(calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", "gone"]]);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "keeps a failed account scoped to its host and recovers when the choice changes",
    () => {
      const { layer, calls } = harness(
        {
          "github.com": { account: "gone" },
          "ghe.acme.test": { account: "enterprise" },
        },
        ["gone"],
      );
      return Effect.gen(function* () {
        const credentials = yield* GitHubCredentials.GitHubCredentials;
        const settings = yield* TestSourceControlHost.TestSourceControlHostSettings;
        expect((yield* Effect.flip(credentials.get("github.com")))._tag).toBe(
          "GitHubNotSignedInError",
        );
        expect(Redacted.value((yield* credentials.get("ghe.acme.test")).token)).toBe(
          "token-for-enterprise",
        );
        yield* settings.update({
          sourceControlHosts: {
            github: {
              hosts: {
                "github.com": { account: "work", enabled: true },
                "ghe.acme.test": { account: "enterprise", enabled: true },
              },
            },
          },
        });
        expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("token-for-work");
        expect(calls).toEqual([
          ["auth", "token", "--hostname", "github.com", "--user", "gone"],
          ["auth", "token", "--hostname", "ghe.acme.test", "--user", "enterprise"],
          ["auth", "token", "--hostname", "github.com", "--user", "work"],
        ]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "resolves directory-aware CLI identities independently for concurrent repositories",
    () => {
      const { layer, calls, invocations } = harness(
        {},
        [],
        {},
        {
          "/repos/personal": "personal",
          "/repos/company/project": "developer",
        },
      );
      return Effect.gen(function* () {
        const credentials = yield* GitHubCredentials.GitHubCredentials;
        const selected = yield* Effect.forEach(
          ["/repos/personal", "/repos/company/project"],
          (cwd) =>
            credentials
              .get("github.com", { cwd })
              .pipe(Effect.map((credential) => Redacted.value(credential.token))),
          { concurrency: "unbounded" },
        );
        expect(selected).toEqual(["token-for-personal", "token-for-developer"]);
        expect(
          invocations.filter((call) => call.args[0] === "api").map((call) => [call.cwd, call.args]),
        ).toEqual([
          ["/repos/personal", ["api", "--hostname", "github.com", "user", "--jq", ".login"]],
          ["/repos/company/project", ["api", "--hostname", "github.com", "user", "--jq", ".login"]],
        ]);
        expect(
          invocations
            .filter((call) => call.args[0] === "auth")
            .map((call) => [call.cwd, call.args.at(-1)]),
        ).toEqual([
          ["/repos/personal", "personal"],
          ["/repos/company/project", "developer"],
        ]);
        yield* credentials.get("github.com", { cwd: "/repos/personal" });
        expect(calls).toHaveLength(4);
        expect(calls.some((call) => call.includes("switch"))).toBe(false);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("does not guess an account when repository identity cannot be verified", () => {
    const accounts = { "/repo": "not a login\nsecret-output" };
    const { layer, calls } = harness({}, [], {}, accounts);
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const error = yield* Effect.flip(credentials.get("github.com", { cwd: "/repo" }));
      expect(error._tag).toBe("GitHubAccountResolutionError");
      expect(error.message).not.toContain("secret-output");
      expect(calls.filter((call) => call[0] === "auth")).toEqual([]);
      accounts["/repo"] = "recovered";
      expect(Redacted.value((yield* credentials.get("github.com", { cwd: "/repo" })).token)).toBe(
        "token-for-recovered",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps explicit Settings selections ahead of directory-aware wrappers", () => {
    const { layer, calls } = harness(
      { "github.com": { account: "chosen" } },
      [],
      {},
      { "/repo": "other" },
    );
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      expect(Redacted.value((yield* credentials.get("github.com", { cwd: "/repo" })).token)).toBe(
        "token-for-chosen",
      );
      expect(calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", "chosen"]]);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "does not forward ambient enterprise tokens to another host during identity resolution",
    () => {
      vi.stubEnv("GH_ENTERPRISE_TOKEN", "ambient-enterprise-token");
      vi.stubEnv("GH_HOST", "trusted.example.test");
      const { layer, invocations } = harness({}, [], {}, { "/repo": "enterprise-user" });
      return Effect.gen(function* () {
        const credentials = yield* GitHubCredentials.GitHubCredentials;
        expect(
          Redacted.value((yield* credentials.get("another.example.test", { cwd: "/repo" })).token),
        ).toBe("token-for-enterprise-user");
        expect(invocations).toHaveLength(2);
        for (const call of invocations) {
          expect(call.args).toContain("another.example.test");
          for (const key of TOKEN_VARIABLES) expect(call.env?.[key]).toBe("");
        }
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("uses a token saved in Settings before GH_TOKEN and gh", () => {
    vi.stubEnv("GH_TOKEN", "env-token");
    const { layer, calls } = harness({}, [], { "github.com": "saved-token" });
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const credential = yield* credentials.get("github.com");
      expect(Redacted.value(credential.token)).toBe("saved-token");
      expect(credential.source).toBe("settings");
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps a host turned off even with a token saved in Settings", () => {
    const { layer } = harness({ "github.com": { enabled: false } }, [], {
      "github.com": "saved-token",
    });
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      expect((yield* Effect.flip(credentials.get("github.com")))._tag).toBe(
        "GitHubHostDisabledError",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("never hands a token to a host that is not a plain hostname", () => {
    vi.stubEnv("GH_TOKEN", "env-token");
    const { layer, calls } = harness();
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      for (const host of ["evil.com#.ghe.com", "evil.com/.ghe.com", "user@x.ghe.com"]) {
        expect(GitHubCredentials.environmentToken(host, { GH_TOKEN: "env-token" })).toBeNull();
        expect((yield* Effect.flip(credentials.get(host)))._tag).toBe("GitHubNotSignedInError");
      }
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layer));
  });
});

import { EnvironmentId, type ServerSelfUpdateCapability } from "@t3tools/contracts";
import { forkReleaseForVersion } from "@t3tools/shared/releaseCompatibility";
import { describe, expect, it } from "vite-plus/test";

import {
  collectRestartingMachines,
  collectServerUpdateTargets,
  filterAvailableServerUpdates,
  closeFinishedUpdateRun,
  collectUpdateEverythingResult,
  describeUpdateCapsule,
  describeUpdateEverything,
  getUpdateEverythingToastView,
  resolveUpdateRunMachineStatus,
  runUpdateEverything,
  type UpdateEverythingMachine,
  type UpdateEverythingRun,
  type UpdateRunMachine,
  type UpdateRunMachineStatus,
  UPDATE_SLOW_AFTER_MS,
} from "./updateEverything.logic";

const runMachine = (overrides: Partial<UpdateRunMachine> = {}): UpdateRunMachine => ({
  environmentId: EnvironmentId.make("alvin"),
  label: "alvin",
  updatesProviders: true,
  server: {
    environmentId: EnvironmentId.make("alvin"),
    serverLabel: "alvin",
    selfUpdate: "boot-service",
    targetVersion: "0.0.50",
  },
  handedOffVersion: null,
  startedAt: 0,
  result: null,
  failure: null,
  providerFailure: null,
  ...overrides,
});

function machine(
  id: string,
  serverVersion: string,
  selfUpdate: ServerSelfUpdateCapability | undefined,
  overrides: Partial<UpdateEverythingMachine> = {},
): UpdateEverythingMachine {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make(id),
        label: id,
        platform: { os: "linux", arch: "x64" },
        serverVersion,
        release: forkReleaseForVersion(serverVersion),
        capabilities: {
          repositoryIdentity: true,
          ...(selfUpdate ? { serverSelfUpdate: selfUpdate } : {}),
          ...(selfUpdate === "desktop-managed" ? { desktopAppUpdate: true } : {}),
        },
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: false,
    canMaintain: true,
    updateState: { status: "idle" },
    ...overrides,
  };
}

describe("collectServerUpdateTargets", () => {
  it("retains the continuation preference for compatible remote update targets", () => {
    const remote = machine("remote", "0.0.40", "boot-service");
    const config = remote.serverConfig!;
    const { targets } = collectServerUpdateTargets(
      [
        {
          ...remote,
          serverConfig: {
            ...config,
            environment: {
              ...config.environment,
              capabilities: {
                ...config.environment.capabilities,
                serverUpdateThreadContinuation: true,
              },
            },
            settings: { continueThreadsAfterServerUpdate: true },
          },
        },
      ],
      "0.0.50",
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      threadContinuation: true,
      continueThreadsAfterServerUpdate: true,
    });
  });

  it("excludes unknown and foreign distributions from update-all, including desktops", () => {
    const unknown = machine("unknown", "0.0.40", "boot-service");
    const foreign = machine("upstream", "0.0.40", "desktop-managed");
    const upstreamCli = machine("upstream-cli", "0.0.40", "boot-service");
    const withoutRelease = { ...unknown.serverConfig!.environment };
    delete withoutRelease.release;
    const { targets, skipped } = collectServerUpdateTargets(
      [
        { ...unknown, serverConfig: { ...unknown.serverConfig!, environment: withoutRelease } },
        {
          ...foreign,
          serverConfig: {
            ...foreign.serverConfig!,
            environment: {
              ...foreign.serverConfig!.environment,
              release: { distribution: "pingdotgg/t3code", channel: "stable" },
            },
          },
        },
        {
          ...upstreamCli,
          serverConfig: {
            ...upstreamCli.serverConfig!,
            environment: {
              ...upstreamCli.serverConfig!.environment,
              release: { distribution: "pingdotgg/t3code", channel: "stable" },
              capabilities: {
                ...upstreamCli.serverConfig!.environment.capabilities,
                serverInstallation: { kind: "npx" },
              },
            },
          },
        },
        machine("fork", "0.0.40", "boot-service"),
        machine("fork-desktop", "0.0.40", "desktop-managed"),
      ],
      "0.0.50",
    );
    expect(targets.map((target) => target.serverLabel)).toEqual(["fork", "fork-desktop"]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["unknown", "unknown release identity"],
      ["upstream", "different release distribution"],
      ["upstream-cli", "different release distribution"],
    ]);
  });

  it("updates compatible remote servers and names every skipped one", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("this-app", "0.0.40", "desktop-managed", { hostedByThisApp: true }),
        machine("service", "0.0.40", "boot-service"),
        machine("nightly-service", "0.0.49-nightly.20261001.3", "boot-service"),
        machine("other-desktop", "0.0.49-nightly.20261001.3", "desktop-managed"),
        machine("offline", "0.0.40", "boot-service", { connected: false }),
        machine("never-connected", "0.0.40", "boot-service", { serverConfig: null }),
        machine("no-scope", "0.0.40", "boot-service", { canMaintain: false }),
        machine("busy", "0.0.40", "boot-service", {
          updateState: {
            status: "running",
            stage: "downloading",
            fromVersion: "0.0.40",
            targetVersion: "0.0.50",
          },
        }),
        machine("current", "0.0.50", "boot-service"),
        machine("current-offline", "0.0.50", "boot-service", { connected: false }),
        machine("manual", "0.0.40", undefined),
      ],
      "0.0.50",
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["service", "0.0.50"],
    ]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["nightly-service", "on the nightly channel"],
      ["other-desktop", "on the nightly channel"],
      ["offline", "not connected"],
      ["never-connected", "not connected"],
      ["no-scope", "no permission"],
      ["busy", "already updating"],
      ["manual", "needs a manual update"],
    ]);
  });
});

describe("collectRestartingMachines", () => {
  it("lists updated servers, and this app's servers only when it installs", () => {
    const withContinuation = (
      id: string,
      overrides: Partial<UpdateEverythingMachine> = {},
      enabled = false,
    ) => {
      const base = machine(id, "0.0.40", "boot-service", overrides);
      return {
        ...base,
        serverConfig: {
          environment: base.serverConfig!.environment,
          settings: { continueThreadsAfterServerUpdate: enabled },
        },
      };
    };
    const machines = [
      withContinuation("this-app", { hostedByThisApp: true }, true),
      withContinuation("alvin", {}, true),
      withContinuation("opted-out", {}, false),
      machine("old", "0.0.40", "boot-service"),
      withContinuation("providers-only"),
    ];
    const servers = ["alvin", "opted-out", "old"].map((id) => ({
      environmentId: EnvironmentId.make(id),
    }));

    expect(collectRestartingMachines(machines, servers, true)).toEqual([
      { environmentId: "this-app", continuesThreads: true },
      { environmentId: "alvin", continuesThreads: true },
      { environmentId: "opted-out", continuesThreads: false },
      { environmentId: "old", continuesThreads: false },
    ]);
    expect(
      collectRestartingMachines(machines, servers, false).map((entry) => entry.environmentId),
    ).toEqual(["alvin", "opted-out", "old"]);
  });
});

describe("runUpdateEverything", () => {
  it("restarts servers after providers finish and returns every result", async () => {
    const calls: string[] = [];
    let providersStarted = () => {};
    const started = new Promise<void>((resolve) => {
      providersStarted = resolve;
    });
    let finishProviders = (_value: string) => {};
    const run = runUpdateEverything({
      downloadLocal: async () => {
        calls.push("download");
        return true;
      },
      updateProviders: () =>
        new Promise<string>((resolve) => {
          calls.push("providers");
          providersStarted();
          finishProviders = resolve;
        }),
      updateServers: async () => {
        calls.push("servers");
        return 2;
      },
    });

    await started;
    expect(calls).toEqual(["download", "providers"]);
    finishProviders("provider results");
    expect(await run).toEqual({ localReady: true, providers: "provider results", servers: 2 });
    expect(calls).toEqual(["download", "providers", "servers"]);
  });

  it("still updates remote machines when the local download fails", async () => {
    const calls: string[] = [];
    const result = await runUpdateEverything({
      downloadLocal: async () => false,
      updateProviders: async () => {
        calls.push("providers");
      },
      updateServers: async () => {
        calls.push("servers");
      },
    });

    expect(calls).toEqual(["providers", "servers"]);
    expect(result.localReady).toBe(false);
  });
});

describe("resolveUpdateRunMachineStatus", () => {
  const running = (stage: "downloading" | "installing" | "resuming") =>
    ({ status: "running", stage, fromVersion: "0.0.40", targetVersion: "0.0.50" }) as const;

  it("follows the run phase, then the server's own update stage", () => {
    const idle = { status: "idle" } as const;
    expect(resolveUpdateRunMachineStatus(runMachine(), "providers", idle)).toBe("providers");
    expect(resolveUpdateRunMachineStatus(runMachine(), "servers", idle)).toBe("waiting");
    expect(resolveUpdateRunMachineStatus(runMachine(), "servers", running("installing"))).toBe(
      "downloading",
    );
    expect(resolveUpdateRunMachineStatus(runMachine(), "servers", running("resuming"))).toBe(
      "restarting",
    );
    expect(
      resolveUpdateRunMachineStatus(
        runMachine({ updatesProviders: false }),
        "providers",
        running("downloading"),
      ),
    ).toBe("downloading");
    expect(resolveUpdateRunMachineStatus(runMachine({ result: "failed" }), "servers", idle)).toBe(
      "failed",
    );
    expect(
      resolveUpdateRunMachineStatus(
        runMachine({ server: null, handedOffVersion: "0.0.50" }),
        "servers",
        idle,
      ),
    ).toBe("restarting");
  });
});

describe("update capsule", () => {
  const run = (overrides: Partial<UpdateEverythingRun> = {}): UpdateEverythingRun => ({
    localVersion: null,
    phase: "servers",
    restartAt: null,
    machines: [],
    ...overrides,
  });
  const view = (
    label: string,
    status: UpdateRunMachineStatus,
    overrides: Partial<UpdateRunMachine> = {},
  ) => ({
    machine: runMachine({ environmentId: EnvironmentId.make(label), label, ...overrides }),
    status,
  });

  it("counts down this app's restart before anything else", () => {
    expect(
      describeUpdateCapsule(
        run({ phase: "countdown", restartAt: 5_000, localVersion: "0.0.50" }),
        [view("alvin", "restarting")],
        { status: "waiting" },
        1_200,
      ),
    ).toEqual({ tone: "default", label: "Restart in 4s", action: "later" });
  });

  it("names the slowest machine once it passes the slow threshold", () => {
    const machines = [
      view("bb-1", "done"),
      view("zbook", "downloading", { startedAt: 60_000 }),
      view("alvin", "restarting", { startedAt: 0 }),
    ];
    expect(describeUpdateCapsule(run(), machines, null, 60_000)).toEqual({
      tone: "default",
      label: "1 of 3 updated",
      action: null,
    });
    expect(describeUpdateCapsule(run(), machines, null, UPDATE_SLOW_AFTER_MS + 6 * 60_000)).toEqual(
      {
        tone: "slow",
        label: "alvin",
        slow: { status: "restarting", elapsed: "9m" },
        action: null,
      },
    );
  });

  it("offers a retry only for failed servers it can update again", () => {
    expect(describeUpdateCapsule(run(), [view("alvin", "failed")], null, 0)).toEqual({
      tone: "failed",
      label: "alvin failed",
      action: "retry",
    });
    expect(
      describeUpdateCapsule(
        run(),
        [view("alvin", "failed", { server: null }), view("box", "failed", { server: null })],
        null,
        0,
      ),
    ).toEqual({ tone: "failed", label: "2 failed", action: "dismiss" });
  });

  it("ends the run only when every machine is done and this app is not installing", () => {
    const done = runMachine({ result: "done" });
    expect(closeFinishedUpdateRun(run({ machines: [done] }))).toBeNull();
    expect(
      closeFinishedUpdateRun(run({ machines: [done], localVersion: "0.0.50" })),
    ).not.toBeNull();
    expect(
      closeFinishedUpdateRun(run({ machines: [runMachine({ result: "failed" })] })),
    ).not.toBeNull();
    expect(closeFinishedUpdateRun(run({ machines: [done], phase: "providers" }))).not.toBeNull();
  });
});

describe("update everything summary", () => {
  const result = collectUpdateEverythingResult({
    localVersion: "0.0.50",
    localFailures: ["Could not download update: Network error."],
    servers: [
      { label: "alvin", outcome: { status: "failed", message: "Download failed." } },
      { label: "box", outcome: { status: "updated" } },
      { label: "studio", outcome: { status: "updated" } },
      { label: "busy", outcome: { status: "skipped" } },
    ],
    providers: [
      { status: "updated" },
      { status: "interrupted" },
      { status: "failed", line: "box · Codex: npm exited with code 1." },
    ],
  });

  it("counts updates and names the machine of each failure", () => {
    expect(result).toEqual({
      localVersion: "0.0.50",
      updatedServers: 2,
      updatedProviders: 1,
      restarting: [],
      failures: [
        "This app: Could not download update: Network error.",
        "alvin: Download failed.",
        "box · Codex: npm exited with code 1.",
      ],
    });
  });

  it("includes this app only when the relaunch landed on its version", () => {
    expect(getUpdateEverythingToastView(result, "0.0.50")).toEqual({
      type: "error",
      title: "Updated this app, 2 servers, and 1 provider",
      description: [
        "This app: Could not download update: Network error.",
        "alvin: Download failed.",
        "box · Codex: npm exited with code 1.",
      ].join("\n"),
    });
    expect(getUpdateEverythingToastView({ ...result, failures: [] }, "0.0.40")).toEqual({
      type: "success",
      title: "Updated 2 servers and 1 provider",
    });
  });

  it("reports a failure when nothing updated, and nothing when nothing finished", () => {
    const empty = { localVersion: null, updatedServers: 0, updatedProviders: 0, restarting: [] };
    expect(
      getUpdateEverythingToastView({ ...empty, failures: ["alvin: offline"] }, "0.0.50"),
    ).toEqual({ type: "error", title: "Update failed", description: "alvin: offline" });
    expect(getUpdateEverythingToastView({ ...empty, failures: [] }, "0.0.50")).toBeNull();
  });

  it("names servers still restarting when this app relaunched", () => {
    expect(
      getUpdateEverythingToastView(
        { ...result, failures: [], restarting: ["alvin", "zbook"] },
        "0.0.50",
      ),
    ).toEqual({
      type: "success",
      title: "Updated this app, 2 servers, and 1 provider",
      description: "alvin and zbook are still restarting.",
    });
  });
});

describe("filterAvailableServerUpdates", () => {
  const targets = () =>
    collectServerUpdateTargets(
      [machine("linux", "0.0.62", "boot-service"), machine("desktop", "0.0.62", "desktop-managed")],
      "0.0.63",
    ).targets;

  it("allows a fork archive without npm publication, including npm-launched servers", () => {
    const result = filterAvailableServerUpdates(
      targets().map((target) => ({
        ...target,
        installation: { kind: "npx" as const },
      })),
      {
        status: "available",
        assets: ["t3-0.0.63-linux-x64.tar.gz", "SHA256SUMS"],
      },
    );
    expect(result.targets.map((target) => target.serverLabel)).toEqual(["linux", "desktop"]);
    expect(result.skipped).toEqual([]);
  });

  it.each([
    ["checking", "checking GitHub release v0.0.63"],
    ["error", "could not check GitHub release v0.0.63; try again later"],
    ["unavailable", "v0.0.63 is not on GitHub Releases yet"],
  ] as const)("skips archive updates while %s and preserves desktop updates", (status, reason) => {
    const result = filterAvailableServerUpdates(targets(), { status });
    expect(result.targets.map((target) => target.serverLabel)).toEqual(["desktop"]);
    expect(result.skipped.map((entry) => [entry.label, entry.reason])).toEqual([["linux", reason]]);
  });

  it.each([
    ["t3-0.0.63-darwin-arm64.tar.gz", "SHA256SUMS"],
    ["t3-0.0.63-linux-x64.tar.gz"],
    ["t3-0.0.62-linux-x64.tar.gz", "SHA256SUMS"],
  ])("requires both the exact platform archive and checksums (%j)", (...assets) => {
    const result = filterAvailableServerUpdates(targets(), { status: "available", assets });
    expect(result.targets.map((target) => target.serverLabel)).toEqual(["desktop"]);
    expect(result.skipped[0]?.reason).toBe(
      "v0.0.63 CLI archive or checksums for linux-x64 are not on GitHub Releases yet",
    );
  });

  it("uses each remote server's platform and maps Windows to win32", () => {
    const result = filterAvailableServerUpdates(
      [{ ...targets()[0]!, platform: { os: "windows", arch: "arm64" } }],
      { status: "available", assets: ["t3-0.0.63-win32-arm64.zip", "SHA256SUMS"] },
    );
    expect(result.targets).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it("skips unsupported or unknown archive platforms", () => {
    const result = filterAvailableServerUpdates(
      [
        { ...targets()[0]!, platform: { os: "darwin", arch: "x64" } },
        { ...targets()[0]!, platform: undefined },
      ],
      { status: "available", assets: ["SHA256SUMS"] },
    );
    expect(result.targets).toEqual([]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      "no supported CLI archive for this platform",
      "no supported CLI archive for this platform",
    ]);
  });
});

describe("describeUpdateEverything", () => {
  it("gives each machine one row with its T3 Code and provider updates", () => {
    const id = EnvironmentId.make;
    const { rows } = describeUpdateEverything({
      localVersion: "1.1.0",
      localMachines: [
        { environmentId: id("local"), label: "Mainbook" },
        { environmentId: id("wsl"), label: "Mainbook WSL" },
      ],
      servers: [
        {
          environmentId: id("npm"),
          serverLabel: "bb-1",
          selfUpdate: "respawn",
          targetVersion: "1.1.0",
        },
      ],
      providerMachines: [
        { environmentId: id("npm"), label: "bb-1", providers: ["Codex", "Claude"] },
        { environmentId: id("local"), label: "Mainbook", providers: ["Codex"] },
        { environmentId: id("manual"), label: "alvin", providers: ["Claude"] },
      ],
      skipped: [
        { environmentId: id("manual"), label: "alvin", reason: "needs a manual update" },
        { environmentId: id("offline"), label: "TheoRoom", reason: "not connected" },
      ],
    });

    expect(
      rows.map(({ label, app, skipped, providers }) => [label, app, skipped, providers]),
    ).toEqual([
      ["Mainbook", "this-app", null, ["Codex"]],
      ["Mainbook WSL", "this-app", null, []],
      ["bb-1", "server", null, ["Codex", "Claude"]],
      ["alvin", null, "needs a manual update", ["Claude"]],
      ["TheoRoom", null, "not connected", []],
    ]);
  });
});

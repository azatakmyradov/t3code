// @effect-diagnostics nodeBuiltinImport:off
// Exercise the checked-in release shell command against temporary archive fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromYaml } from "@t3tools/shared/schemaYaml";

const Step = Schema.Struct({
  name: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
});
const Workflow = fromYaml(
  Schema.Struct({
    jobs: Schema.Record(
      Schema.String,
      Schema.Struct({
        name: Schema.optional(Schema.String),
        if: Schema.optional(Schema.String),
        needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
        with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        steps: Schema.optional(Schema.Array(Step)),
      }),
    ),
  }),
);
const workflow = Schema.decodeSync(Workflow)(
  NodeFS.readFileSync(new URL("../.github/workflows/fork-release.yml", import.meta.url), "utf8"),
);
const linuxIt = HostProcess.Platform.defaultValue() === "linux" ? it : it.skip;
const version = "9.9.9";
const macArchive = `t3-${version}-darwin-arm64.tar.gz`;
const linuxArchive = `t3-${version}-linux-x64.tar.gz`;
const checksumCommand =
  workflow.jobs.publish?.steps?.find((step) => step.name === "Write archive checksums")?.run ??
  assert.fail("Missing archive checksum command");

function writeChecksums(archives: Record<string, string>): string {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-release-"));
  const assets = NodePath.join(root, "release-assets");
  try {
    NodeFS.mkdirSync(assets);
    for (const [name, content] of Object.entries(archives)) {
      NodeFS.writeFileSync(NodePath.join(assets, name), content);
    }
    NodeChildProcess.execFileSync("bash", ["-c", checksumCommand], {
      cwd: root,
      env: { ...process.env, RELEASE_VERSION: version },
      stdio: "pipe",
    });
    return NodeFS.readFileSync(NodePath.join(assets, "SHA256SUMS"), "utf8");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

describe("fork release server archives", () => {
  it("always builds one Linux x64 CLI independently of optional desktop platforms", () => {
    assert.equal(workflow.jobs.cli_linux_x64?.if, undefined);
    assert.equal(workflow.jobs.cli_linux_x64?.needs, "build_bundle");
    assert.equal(workflow.jobs.desktop_linux_x64?.if, "${{ inputs.all_platforms }}");
    assert.equal(workflow.jobs.desktop_linux_x64?.with?.cli_archive, false);
    assert.equal(workflow.jobs.cli_linux_x64?.name, "Build Linux x64");
    assert.equal(workflow.jobs.desktop_linux_arm64?.with?.label, "Linux arm64");
    assert.ok(workflow.jobs.publish?.needs?.includes("cli_linux_x64"));
    assert.ok(workflow.jobs.publish?.if?.includes("needs.cli_linux_x64.result == 'success'"));
  });

  linuxIt("writes exact checksums for both default archives and optional platforms", () => {
    const archives = {
      [macArchive]: "mac runtime",
      [linuxArchive]: "linux runtime",
      [`t3-${version}-linux-arm64.tar.gz`]: "arm runtime",
      [`t3-${version}-win32-x64.zip`]: "windows runtime",
    };
    const manifest = writeChecksums(archives);
    for (const [name, content] of Object.entries(archives)) {
      const digest = NodeCrypto.createHash("sha256").update(content).digest("hex");
      assert.ok(manifest.includes(`${digest}  ${name}\n`));
    }
    assert.equal(manifest.trim().split("\n").length, Object.keys(archives).length);
  });

  linuxIt("rejects a release with only the Mac archive", () => {
    assert.throws(() => writeChecksums({ [macArchive]: "mac runtime" }));
  });

  linuxIt("rejects missing Mac, empty Linux, and Linux archives from the wrong version", () => {
    assert.throws(() => writeChecksums({ [linuxArchive]: "linux runtime" }));
    assert.throws(() => writeChecksums({ [macArchive]: "mac runtime", [linuxArchive]: "" }));
    assert.throws(() =>
      writeChecksums({
        [macArchive]: "mac runtime",
        "t3-9.9.8-linux-x64.tar.gz": "old linux runtime",
      }),
    );
  });
});

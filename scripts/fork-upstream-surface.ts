import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

interface UpstreamBase {
  readonly upstreamBaseSha: string;
  readonly forkOwnedRoots: ReadonlyArray<string>;
  readonly allowedIntegrationFiles: ReadonlyArray<string>;
}

const root = NodePath.resolve(import.meta.dirname, "..");
const config = JSON.parse(
  NodeFS.readFileSync(NodePath.resolve(root, "docs/fork/upstream-base.json"), "utf8"),
) as UpstreamBase;

const allowedIntegrationFiles = new Set(config.allowedIntegrationFiles);

function git(args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fail(message: string): never {
  process.stderr.write(`fork-upstream-surface: ${message}\n`);
  process.exit(1);
}

try {
  NodeChildProcess.execFileSync(
    "git",
    ["merge-base", "--is-ancestor", config.upstreamBaseSha, "HEAD"],
    {
      cwd: root,
      stdio: "ignore",
    },
  );
} catch {
  fail(`recorded upstream base ${config.upstreamBaseSha} is not an ancestor of HEAD`);
}

const changed = new Set(
  [
    ...git(["diff", "--name-only", config.upstreamBaseSha]).split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean),
);
const outsideSurface = [...changed].filter(
  (file) =>
    !config.forkOwnedRoots.some((rootPrefix) => file.startsWith(rootPrefix)) &&
    !allowedIntegrationFiles.has(file),
);
if (outsideSurface.length > 0) {
  fail(`changes escaped the owned roots and adapter allowlist:\n${outsideSurface.join("\n")}`);
}

const contractSources = git(["ls-files", "packages/contracts/src/*.ts"])
  .split("\n")
  .filter(Boolean);
for (const file of contractSources) {
  if (
    NodeFS.readFileSync(NodePath.resolve(root, file), "utf8").includes("@t3tools/fork-subagents")
  ) {
    fail(`core contracts import the fork package: ${file}`);
  }
}

const migrations = NodeFS.readFileSync(
  NodePath.resolve(root, "apps/server/src/persistence/Migrations.ts"),
  "utf8",
);
if (/Subagent|fork[_-]subagent/i.test(migrations)) {
  fail("a subagent migration was added to the numbered core migration ledger");
}

const orchestration = NodeFS.readFileSync(
  NodePath.resolve(root, "packages/contracts/src/orchestration.ts"),
  "utf8",
);
const threadModel = orchestration.slice(
  orchestration.indexOf("export const OrchestrationThread ="),
  orchestration.indexOf("export type OrchestrationThread ="),
);
const threadCreate = orchestration.slice(
  orchestration.indexOf("const ThreadCreateCommand ="),
  orchestration.indexOf("const ThreadDeleteCommand ="),
);
const threadCreated = orchestration.slice(
  orchestration.indexOf("export const ThreadCreatedPayload ="),
  orchestration.indexOf("export const ThreadDeletedPayload ="),
);
if (/\bsubagents?\s*:/.test(threadModel + threadCreate + threadCreated)) {
  fail("subagent fields reappeared on a core thread or thread-create schema");
}

const projectionSources = [
  "apps/server/src/persistence/Layers/ProjectionThreads.ts",
  "apps/server/src/persistence/Services/ProjectionThreads.ts",
  "apps/server/src/orchestration/Layers/ProjectionPipeline.ts",
];
for (const file of projectionSources) {
  if (
    /\b(parent_thread_id|subagent_[a-z_]+|parentThreadId|subagent[A-Z])\b/.test(
      NodeFS.readFileSync(NodePath.resolve(root, file), "utf8"),
    )
  ) {
    fail(`subagent fields reappeared in the core projection surface: ${file}`);
  }
}

const fixtureOnlyChanges = [...changed].filter(
  (file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !config.forkOwnedRoots.some((rootPrefix) => file.startsWith(rootPrefix)) &&
    !allowedIntegrationFiles.has(file),
);
if (fixtureOnlyChanges.length > 0) {
  fail(
    `unreviewed upstream test/fixture changes were introduced:\n${fixtureOnlyChanges.join("\n")}`,
  );
}

process.stdout.write(
  `fork-upstream-surface: ok (${changed.size} changed files, ${allowedIntegrationFiles.size} adapter files)\n`,
);

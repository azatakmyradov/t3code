import * as NodeOS from "node:os";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import { it as effectIt } from "@effect/vitest";
import { assert, it } from "vite-plus/test";

import { hydratePosixHome, resolveBaseDir } from "./os-jank.ts";

effectIt.effect("defaults to the fork home and respects explicit home overrides", () =>
  Effect.gen(function* () {
    assert.equal(yield* resolveBaseDir(undefined), `${NodeOS.homedir()}/.t3-fork`);
    assert.equal(yield* resolveBaseDir(" "), `${NodeOS.homedir()}/.t3-fork`);
    assert.equal(yield* resolveBaseDir("~/custom-t3"), `${NodeOS.homedir()}/custom-t3`);
    assert.equal(yield* resolveBaseDir("/tmp/isolated-home"), "/tmp/isolated-home");
  }).pipe(Effect.provide(NodePath.layerPosix)),
);

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

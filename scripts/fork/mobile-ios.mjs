#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";

const variantArg = process.argv[2] ?? "prod";
const variantByAlias = {
  prod: "production",
  production: "production",
  preview: "preview",
  dev: "development",
  development: "development",
};
const configurationByVariant = {
  production: "Release",
  preview: "Release",
  development: "Debug",
};

const variant = variantByAlias[variantArg];
if (!variant) {
  console.error("Usage: node scripts/fork/mobile-ios.mjs prod|preview|dev");
  process.exit(1);
}

const env = {
  ...process.env,
  APP_VARIANT: variant,
  EXPO_NO_GIT_STATUS: "1",
};
if (process.env.IOS_BUNDLE_ID) {
  env.T3CODE_IOS_BUNDLE_IDENTIFIER = process.env.IOS_BUNDLE_ID;
}

function run(command, args, options = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    stdio: "inherit",
    env,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const configuration = process.env.IOS_CONFIGURATION ?? configurationByVariant[variant];

run("vp", ["exec", "expo", "prebuild", "--clean", "--platform", "ios"], {
  cwd: "apps/mobile",
});
run("vp", ["exec", "expo", "run:ios", "--device", "--configuration", configuration], {
  cwd: "apps/mobile",
});

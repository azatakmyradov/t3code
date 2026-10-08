import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["darwin", "linux", "win32"] as const)(
  "leaves original profiles and credential keys untouched on %s",
  (platform) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-profile-" });
      for (const original of ["t3code", "t3code-v2", "T3 Code (Alpha)", "T3 Code (Dev)"]) {
        yield* fs.makeDirectory(path.join(directory, original), { recursive: true });
        yield* fs.writeFileString(path.join(directory, original, "Local State"), "original keys");
      }
      for (const isDevelopment of [false, true]) {
        const profile = yield* resolveUserDataPath({
          appDataDirectory: directory,
          isDevelopment,
          platform,
        });
        assert.equal(profile, path.join(directory, isDevelopment ? "t3-fork-dev" : "t3-fork"));
        assert.isTrue(yield* fs.exists(profile));
        assert.isFalse(yield* fs.exists(path.join(profile, "Local State")));
        yield* fs.writeFileString(path.join(profile, "Local State"), "fork keys");
        yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment, platform });
        assert.equal(yield* fs.readFileString(path.join(profile, "Local State")), "fork keys");
      }
      assert.equal(
        yield* fs.readFileString(path.join(directory, "t3code-v2", "Local State")),
        "original keys",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("identifies a failed fork profile creation and preserves its cause", () => {
  const destination = "/profiles/t3-fork";
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "makeDirectory",
    pathOrDescriptor: destination,
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
      platform: "win32",
    }).pipe(Effect.flip);
    assert.equal(error.operation, "create-directory");
    assert.equal(error.resourcePath, destination);
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({ makeDirectory: () => Effect.fail(cause) }),
    ),
    Effect.provide(NodeServices.layer),
  );
});

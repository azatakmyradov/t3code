import { createNativeSubagentEnvironmentAtoms } from "@t3tools/client-runtime/state/native-subagents";

import { connectionAtomRuntime } from "../connection/runtime";

export const nativeSubagentEnvironment =
  createNativeSubagentEnvironmentAtoms(connectionAtomRuntime);

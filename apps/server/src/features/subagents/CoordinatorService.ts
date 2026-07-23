import type { ThreadId } from "@t3tools/contracts";
import type {
  SubagentCheckResult,
  SubagentId,
  SubagentListResult,
  SubagentOutputSection,
  SubagentSpawnRequest,
  SubagentSpawnResult,
} from "@t3tools/fork-subagents/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type {
  SubagentCheckResult,
  SubagentListResult,
  SubagentOutputSection,
  SubagentSpawnRequest,
  SubagentSpawnResult,
} from "@t3tools/fork-subagents/contracts";

export class SubagentCoordinatorError extends Schema.TaggedErrorClass<SubagentCoordinatorError>()(
  "SubagentCoordinatorError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface SubagentCoordinatorShape {
  readonly spawn: (
    parentThreadId: ThreadId,
    request: SubagentSpawnRequest,
  ) => Effect.Effect<SubagentSpawnResult, SubagentCoordinatorError>;
  readonly wait: (
    parentThreadId: ThreadId,
    displayIds: ReadonlyArray<SubagentId>,
  ) => Effect.Effect<ReadonlyArray<SubagentOutputSection>, SubagentCoordinatorError>;
  readonly cancel: (
    parentThreadId: ThreadId,
    displayIds: ReadonlyArray<SubagentId>,
  ) => Effect.Effect<
    ReadonlyArray<{ displayId: SubagentId; cancelled: boolean }>,
    SubagentCoordinatorError
  >;
  readonly check: (
    parentThreadId: ThreadId,
    displayId: SubagentId,
  ) => Effect.Effect<SubagentCheckResult, SubagentCoordinatorError>;
  readonly list: (
    parentThreadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<SubagentListResult>, SubagentCoordinatorError>;
}

export class SubagentCoordinator extends Context.Service<
  SubagentCoordinator,
  SubagentCoordinatorShape
>()("t3/features/subagents/CoordinatorService/SubagentCoordinator") {}

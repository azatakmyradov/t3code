import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId } from "./baseSchemas.ts";

export const DesktopAgentNotificationInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
  title: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
  body: Schema.optionalKey(Schema.String.check(Schema.isTrimmed())),
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type DesktopAgentNotificationInput = typeof DesktopAgentNotificationInputSchema.Type;

export const DesktopAgentNotificationActivatedPayloadSchema = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type DesktopAgentNotificationActivatedPayload =
  typeof DesktopAgentNotificationActivatedPayloadSchema.Type;

export interface ForkDesktopBridge {
  showAgentNotification: (input: DesktopAgentNotificationInput) => Promise<boolean>;
  onAgentNotificationActivated: (
    listener: (payload: DesktopAgentNotificationActivatedPayload) => void,
  ) => () => void;
}

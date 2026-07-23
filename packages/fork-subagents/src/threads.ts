import { ThreadId } from "@t3tools/contracts";

export const SUBAGENT_THREAD_ID_PREFIX = "t3-internal-subagent-";

export function makeSubagentThreadId(uuid: string): ThreadId {
  return ThreadId.make(`${SUBAGENT_THREAD_ID_PREFIX}${uuid}`);
}

export function isSubagentThreadId(threadId: string): boolean {
  return threadId.startsWith(SUBAGENT_THREAD_ID_PREFIX);
}

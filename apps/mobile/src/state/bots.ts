import { useAtomValue } from "@effect/atom-react";
import {
  createBotNavigationAtom,
  createBotIdsAtom,
  findBotForThread,
} from "@t3tools/client-runtime/state/bots";
import type { ThreadId } from "@t3tools/contracts";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";

export const botNavigationAtom = createBotNavigationAtom(
  environmentServerConfigsAtom,
  serverEnvironment.bots.list,
);
export const botIdsAtom = createBotIdsAtom(botNavigationAtom);

export function useBotForThread(threadId: ThreadId | null) {
  return findBotForThread(useAtomValue(botNavigationAtom), threadId);
}

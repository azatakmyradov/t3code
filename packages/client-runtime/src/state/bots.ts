import {
  WS_METHODS,
  botIdForThread,
  type BotId,
  type BotList,
  type BotNavigationThread,
  type BotPermissions,
  type BotSummary,
  type EnvironmentId,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { connectBotEnvironment } from "../rpc/botConnections.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createBotEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "bots:list",
    tag: WS_METHODS.botsSubscribe,
  });
  return {
    list,
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "bots:detail",
      tag: WS_METHODS.botsGet,
      staleTimeMs: 0,
      refreshIntervalMs: 30000,
      refreshTrigger: (target) => list({ environmentId: target.environmentId, input: {} }),
    }),
    connections: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "bots:connections",
      tag: WS_METHODS.botsConnections,
      staleTimeMs: 0,
    }),
    sendMessage: createEnvironmentRpcCommand(runtime, {
      label: "bots:send",
      tag: WS_METHODS.botsSendMessage,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "bots:create",
      tag: WS_METHODS.botsCreate,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "bots:update",
      tag: WS_METHODS.botsUpdate,
    }),
    writeContext: createEnvironmentRpcCommand(runtime, {
      label: "bots:context",
      tag: WS_METHODS.botsWriteContext,
    }),
    cancelTask: createEnvironmentRpcCommand(runtime, {
      label: "bots:cancel",
      tag: WS_METHODS.botsCancelTask,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "bots:delete",
      tag: WS_METHODS.botsDelete,
    }),
    startTask: createEnvironmentRpcCommand(runtime, {
      label: "bots:task",
      tag: WS_METHODS.botsStartTask,
    }),
    request: createEnvironmentRpcCommand(runtime, {
      label: "bots:request",
      tag: WS_METHODS.botsRequest,
    }),
    reply: createEnvironmentRpcCommand(runtime, { label: "bots:reply", tag: WS_METHODS.botsReply }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "bots:connect",
      tag: WS_METHODS.botsConnect,
      execute: connectBotEnvironment,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "bots:disconnect",
      tag: WS_METHODS.botsDisconnect,
    }),
  };
}

export interface BotNavigationEntry {
  readonly bot: BotSummary;
  readonly threads: ReadonlyArray<BotNavigationThread>;
}

/** Lean navigation refs for every bot-capable environment; never loads message history. */
export function createBotNavigationAtom(
  serverConfigsAtom: Atom.Atom<ReadonlyMap<EnvironmentId, ServerConfig>>,
  listAtom: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: {};
  }) => Atom.Atom<AsyncResult.AsyncResult<BotList, unknown>>,
) {
  return Atom.make((get) => {
    const entries: BotNavigationEntry[] = [];
    for (const [environmentId, config] of get(serverConfigsAtom)) {
      if (config.environment.capabilities.bots !== true) continue;
      const data = Option.getOrNull(AsyncResult.value(get(listAtom({ environmentId, input: {} }))));
      if (data === null) continue;
      const threadsByBot = new Map<BotId, BotNavigationThread[]>();
      for (const thread of data.threads) {
        const threads = threadsByBot.get(thread.botId);
        if (threads) threads.push(thread);
        else threadsByBot.set(thread.botId, [thread]);
      }
      for (const bot of data.bots) entries.push({ bot, threads: threadsByBot.get(bot.id) ?? [] });
    }
    return entries;
  });
}

/** Ids of every loaded bot; stable until a bot is added or removed. */
export function createBotIdsAtom(navigationAtom: Atom.Atom<BotNavigationEntry[]>) {
  let previous: ReadonlySet<BotId> = new Set();
  return Atom.make((get) => {
    const ids = new Set(get(navigationAtom).map(({ bot }) => bot.id));
    if (ids.size === previous.size && [...ids].every((id) => previous.has(id))) return previous;
    previous = ids;
    return ids;
  });
}

/**
 * Whether a thread belongs to a loaded bot, so ordinary thread lists can leave it to the bot UI.
 * Threads of deleted or unreachable bots stay visible in their projects.
 */
export function isBotThread(botIds: ReadonlySet<BotId>, threadId: ThreadId) {
  const botId = botIdForThread(threadId);
  return botId !== null && botIds.has(botId);
}

/** The bot owning a main or task thread, if it is loaded. */
export function findBotForThread(
  entries: ReadonlyArray<BotNavigationEntry>,
  threadId: ThreadId | null,
) {
  const botId = threadId === null ? null : botIdForThread(threadId);
  return botId === null ? null : (entries.find(({ bot }) => bot.id === botId) ?? null);
}

type Access = BotPermissions["projects"][number];
type Project = {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly workspaceRoot: string;
};

export const BOT_PROJECT_SELECTION_LIMIT = 100;
export const botProjectKey = (access: Access) => `${access.environmentId}/${access.projectId}`;

/** Keep disconnected grants visible so editing the picker cannot silently revoke them. */
export function botProjectOptions(
  projects: ReadonlyArray<Project>,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>,
  selected: BotPermissions["projects"],
) {
  const labels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const options = projects.map((project) => {
    const access = { environmentId: project.environmentId, projectId: project.id };
    return {
      key: botProjectKey(access),
      access,
      title: project.title,
      path: project.workspaceRoot,
      environmentLabel: labels.get(project.environmentId) ?? "Disconnected environment",
      available: true,
    };
  });
  const known = new Set(options.map((option) => option.key));
  for (const access of selected) {
    const key = botProjectKey(access);
    if (known.has(key)) continue;
    known.add(key);
    options.push({
      key,
      access,
      title: "Unavailable project",
      path: access.projectId,
      environmentLabel: labels.get(access.environmentId) ?? "Disconnected environment",
      available: false,
    });
  }
  return options.sort(
    (a, b) =>
      a.environmentLabel.localeCompare(b.environmentLabel) ||
      a.access.environmentId.localeCompare(b.access.environmentId) ||
      a.title.localeCompare(b.title),
  );
}
export type BotProjectOption = ReturnType<typeof botProjectOptions>[number];

export function filterBotProjectOptions(
  options: ReadonlyArray<BotProjectOption>,
  selected: ReadonlySet<string>,
  query: string,
  selectedOnly: boolean,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    if (selectedOnly && !selected.has(option.key)) return false;
    const text = `${option.title} ${option.environmentLabel} ${option.path}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function toggleBotProject(selected: BotPermissions["projects"], access: Access) {
  const key = botProjectKey(access);
  if (selected.some((item) => botProjectKey(item) === key))
    return selected.filter((item) => botProjectKey(item) !== key);
  return selected.length >= BOT_PROJECT_SELECTION_LIMIT ? selected : [...selected, access];
}

export function selectAllBotProjects(
  selected: BotPermissions["projects"],
  options: ReadonlyArray<BotProjectOption>,
) {
  const combined = new Map(selected.map((access) => [botProjectKey(access), access]));
  for (const option of options) if (option.available) combined.set(option.key, option.access);
  return combined.size > BOT_PROJECT_SELECTION_LIMIT ? selected : [...combined.values()];
}

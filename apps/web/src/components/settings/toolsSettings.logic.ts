import {
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderSkill,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  resolveProviderSkillSourceKind,
  resolveProviderSkillsForCwd,
} from "@t3tools/client-runtime/providerSkills";

/** Serialize read-modify-write operations using the last successful server response.
 * Settings pushes can lag behind clicks and RPC responses. Keep that response until
 * the settings subscription advances, including when several checkouts share a host.
 */
export function createToolsSettingsWriter(
  read: (environmentId: EnvironmentId) => ServerSettings | null,
  write: (
    environmentId: EnvironmentId,
    patch: ServerSettingsPatch,
  ) => Promise<ServerSettings | null>,
) {
  const lanes = new Map<
    EnvironmentId,
    {
      source: ServerSettings | null;
      settings: ServerSettings | null;
      unacknowledged: string[];
      pending: Promise<void>;
    }
  >();
  return (
    environmentId: EnvironmentId,
    apply: (settings: ServerSettings) => ServerSettingsPatch | null,
  ) => {
    let lane = lanes.get(environmentId);
    if (lane === undefined) {
      const source = read(environmentId);
      lane = { source, settings: source, unacknowledged: [], pending: Promise.resolve() };
      lanes.set(environmentId, lane);
    }
    const current = lane;
    const reconcile = () => {
      const source = read(environmentId);
      if (source === current.source) return;
      current.source = source;
      const acknowledged = current.unacknowledged.indexOf(JSON.stringify(source));
      if (acknowledged === -1) {
        // A previously unseen update (for example from another client) is authoritative.
        current.unacknowledged = [];
        current.settings = source;
      } else {
        current.unacknowledged.splice(0, acknowledged + 1);
        // A push for A can arrive after the RPC for B. Keep B until its push arrives.
        if (current.unacknowledged.length === 0) current.settings = source;
      }
    };
    const run = async () => {
      reconcile();
      if (current.settings === null) return;
      const patch = apply(current.settings);
      if (patch === null) return;
      const saved = await write(environmentId, patch);
      if (saved !== null) {
        if (current.unacknowledged.length === 0) {
          current.unacknowledged.push(JSON.stringify(current.source));
        }
        const savedKey = JSON.stringify(saved);
        current.unacknowledged.push(savedKey);
        current.settings = saved;
        reconcile();
        if (JSON.stringify(current.source) === savedKey) current.unacknowledged = [];
      }
    };
    current.pending = current.pending.then(run, run);
    return current.pending;
  };
}

/** Where a skill lives, the groups the Skills page shows in order. */
export type SkillGroupKind = "project" | "personal" | "plugin" | "system";

export const SKILL_GROUP_LABELS: Readonly<Record<SkillGroupKind, string>> = {
  project: "Repository",
  personal: "Personal",
  plugin: "Plugins",
  system: "Built in",
};

export interface SkillProviderRef {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
}

/**
 * One row of the Skills page: every provider instance that loads a skill of
 * this name, merged. Skills are switched by name, so two folders holding a
 * skill of the same name are one row; their paths are listed as copies.
 */
export interface SkillRow {
  readonly name: string;
  readonly description: string | undefined;
  readonly group: SkillGroupKind;
  readonly paths: ReadonlyArray<string>;
  readonly providers: ReadonlyArray<SkillProviderRef>;
  /** Off in the provider's own settings (e.g. Claude's `skillOverrides`). */
  readonly disabledByProvider: boolean;
}

function skillGroup(skill: ServerProviderSkill): SkillGroupKind {
  switch (resolveProviderSkillSourceKind(skill)) {
    case "project":
    case "repo":
      return "project";
    case "personal":
      return "personal";
    case "app":
      return "plugin";
    case "system":
    case "other":
      return skill.scope?.trim().toLowerCase() === "plugin" ? "plugin" : "system";
  }
}

const GROUP_ORDER: ReadonlyArray<SkillGroupKind> = ["project", "personal", "plugin", "system"];

const isFilePath = (path: string) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);

/**
 * The skills every enabled provider instance on one environment discovers,
 * for the checkout at `cwd` when one is given (falling back to each
 * provider's own launch directory until its snapshot for `cwd` arrives).
 * A skill reached from a project folder by any provider counts as a project
 * skill, so the group follows the most specific location.
 */
export function collectSkillRows(
  providers: ReadonlyArray<ServerProvider>,
  cwd: string | null,
): ReadonlyArray<SkillRow> {
  const rows = new Map<
    string,
    {
      name: string;
      description: string | undefined;
      group: SkillGroupKind;
      paths: Set<string>;
      providers: Map<ProviderInstanceId, SkillProviderRef>;
      disabledByProvider: boolean;
    }
  >();
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const skills = cwd === null ? provider.skills : resolveProviderSkillsForCwd(provider, cwd);
    for (const skill of skills) {
      const key = skill.name.trim().toLowerCase();
      if (key.length === 0) continue;
      const group = skillGroup(skill);
      const ref: SkillProviderRef = {
        instanceId: provider.instanceId,
        driver: provider.driver,
        displayName: provider.displayName ?? provider.instanceId,
      };
      // Pi reports a synthetic `pi:skill:<name>` id instead of a file.
      const path = isFilePath(skill.path) ? skill.path : null;
      const existing = rows.get(key);
      if (existing === undefined) {
        rows.set(key, {
          name: skill.name.trim(),
          description: skill.description ?? skill.shortDescription,
          group,
          paths: new Set(path === null ? [] : [path]),
          providers: new Map([[provider.instanceId, ref]]),
          disabledByProvider: !skill.enabled,
        });
        continue;
      }
      if (GROUP_ORDER.indexOf(group) < GROUP_ORDER.indexOf(existing.group)) existing.group = group;
      existing.description ??= skill.description ?? skill.shortDescription;
      if (path !== null) existing.paths.add(path);
      existing.providers.set(provider.instanceId, ref);
      // Off only when every provider that has it turned it off itself.
      existing.disabledByProvider &&= !skill.enabled;
    }
  }
  return [...rows.values()]
    .map((row) => ({
      name: row.name,
      description: row.description,
      group: row.group,
      paths: [...row.paths].toSorted(),
      providers: [...row.providers.values()].toSorted((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
      disabledByProvider: row.disabledByProvider,
    }))
    .toSorted(
      (left, right) =>
        GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) ||
        left.name.localeCompare(right.name),
    );
}

export function groupSkillRows(
  rows: ReadonlyArray<SkillRow>,
): ReadonlyArray<{ readonly group: SkillGroupKind; readonly rows: ReadonlyArray<SkillRow> }> {
  return GROUP_ORDER.flatMap((group) => {
    const groupRows = rows.filter((row) => row.group === group);
    return groupRows.length === 0 ? [] : [{ group, rows: groupRows }];
  });
}

export function filterSkillRows(rows: ReadonlyArray<SkillRow>, query: string) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      (row.description?.toLowerCase().includes(needle) ?? false),
  );
}

/** Whether `providers` covers only some of the enabled instances, so the row should name them. */
export function skillReachesSomeProviders(row: SkillRow, enabledProviderCount: number): boolean {
  return row.providers.length < enabledProviderCount;
}

/** The environment's list with one skill switched. Sorted so equal lists compare equal. */
export function withSkillDisabled(
  disabledSkills: ReadonlyArray<string>,
  name: string,
  disabled: boolean,
): ReadonlyArray<string> {
  const next = new Set(
    disabledSkills.filter((entry) => entry.toLowerCase() !== name.toLowerCase()),
  );
  if (disabled) next.add(name);
  return [...next].toSorted();
}

export function isSkillDisabled(disabledSkills: ReadonlyArray<string>, name: string): boolean {
  const lowered = name.toLowerCase();
  return disabledSkills.some((entry) => entry.toLowerCase() === lowered);
}

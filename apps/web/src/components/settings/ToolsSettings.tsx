import {
  type EnvironmentId,
  type ProjectId,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  collectSkillRows,
  createToolsSettingsWriter,
  filterSkillRows,
  groupSkillRows,
  isSkillDisabled,
  SKILL_GROUP_LABELS,
  skillReachesSomeProviders,
  type SkillRow,
  withSkillDisabled,
} from "./toolsSettings.logic";
import { useScopedSettings, useScopedSettingsWriteAllowed } from "./useScopedSettings";

const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];

interface ToolsTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly projectId: ProjectId | null;
  readonly cwd: string | null;
}

/**
 * The environments and project checkouts a Tools change writes to. Project
 * scope writes the project's override on each member's environment, so one
 * edit reaches the project everywhere it is checked out.
 */
function useToolsTargets(): ReadonlyArray<ToolsTarget> {
  const { scope, connectedEnvironments } = useSettingsScope();
  return useMemo(() => {
    const connected = new Map(
      connectedEnvironments.map((environment) => [environment.environmentId, environment]),
    );
    if (scope.kind === "project" || scope.kind === "checkout") {
      return scope.members.flatMap((member) => {
        const environment = connected.get(member.environmentId);
        return environment
          ? [
              {
                environmentId: member.environmentId,
                label: environment.label,
                projectId: member.id,
                cwd: member.workspaceRoot,
              },
            ]
          : [];
      });
    }
    return connectedEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      projectId: null,
      cwd: null,
    }));
  }, [connectedEnvironments, scope]);
}

/**
 * Write a Tools change to every target. `apply` receives the target's raw
 * environment settings and returns its patch: the environment's own key at
 * environment scope, or the project's override entry at project scope.
 */
function usePersistToolsPatch() {
  const targets = useToolsTargets();
  const registry = useContext(RegistryContext);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update tools",
  });
  const writer = useMemo(
    () =>
      createToolsSettingsWriter(
        (environmentId) => registry.get(serverEnvironment.settingsValueAtom(environmentId)),
        async (environmentId, patch) => {
          const result = await updateSettings({ environmentId, input: { patch } });
          return result._tag === "Success" ? result.value : null;
        },
      ),
    [registry, updateSettings],
  );
  return useCallback(
    (
      apply: (input: {
        readonly settings: ServerSettings;
        readonly projectId: ProjectId | null;
      }) => ServerSettingsPatch | null,
    ) => {
      for (const target of targets) {
        void writer(target.environmentId, (settings) =>
          apply({ settings, projectId: target.projectId }),
        );
      }
    },
    [targets, writer],
  );
}

type PersistToolsPatch = ReturnType<typeof usePersistToolsPatch>;

/** Replace one key of a project's override entry, dropping the key (or the entry) when empty. */
function projectOverridePatch(
  settings: {
    readonly projectSettingsOverrides: Readonly<Record<string, Record<string, unknown>>>;
  },
  projectId: ProjectId,
  key: "disabledSkills",
  value: Readonly<Record<string, unknown>>,
): ServerSettingsPatch {
  const { [key]: _previous, ...rest } = settings.projectSettingsOverrides[projectId] ?? {};
  const next = Object.keys(value).length === 0 ? rest : { ...rest, [key]: value };
  return {
    projectSettingsOverrides: {
      [projectId]: Object.keys(next).length === 0 ? null : next,
    },
  } as ServerSettingsPatch;
}

export function ToolsSettings() {
  const persist = usePersistToolsPatch();
  return (
    <SettingsPageContainer>
      <SkillsPanel persist={persist} />
    </SettingsPageContainer>
  );
}

// ── Skills ───────────────────────────────────────────────────────────

function SkillsPanel({ persist }: { readonly persist: PersistToolsPatch }) {
  const { scope, target, connectedEnvironments } = useSettingsScope();
  const environmentId = target?.environmentId ?? null;
  const targets = useToolsTargets();
  const cwd = targets.find((candidate) => candidate.environmentId === environmentId)?.cwd ?? null;
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId ?? ("" as EnvironmentId))) ??
    EMPTY_PROVIDERS;
  const disabledSkills = useScopedSettings((settings) => settings.disabledSkills);
  const canWrite = useScopedSettingsWriteAllowed();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const enabledProviders = useMemo(
    () => providers.filter((provider) => provider.enabled),
    [providers],
  );
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  const refresh = async (fresh: boolean) => {
    if (environmentId === null) return;
    setRefreshing(true);
    try {
      await Promise.all(
        enabledProviders.map((provider) =>
          refreshProviders({
            environmentId,
            input: {
              instanceId: provider.instanceId,
              ...(cwd === null ? {} : { cwd }),
              ...(fresh ? { fresh: true } : {}),
            },
          }),
        ),
      );
    } finally {
      setRefreshing(false);
    }
  };

  // A project's skills live in its checkout, which each provider only scans
  // when asked; the composer does the same before showing its skill menu.
  // Keyed on the checkout and provider set, not on every status push, which
  // would rescan each time the scan's own result arrives.
  const scanKey = `${environmentId}:${cwd}:${enabledProviders.map((provider) => provider.instanceId).join(",")}`;
  const scannedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (cwd === null || scannedKeyRef.current === scanKey) return;
    scannedKeyRef.current = scanKey;
    void refresh(false);
  }, [cwd, refresh, scanKey]);

  const rows = useMemo(() => collectSkillRows(providers, cwd), [cwd, providers]);
  const groups = useMemo(() => groupSkillRows(filterSkillRows(rows, query)), [query, rows]);

  const setSkillDisabled = (name: string, disabled: boolean) =>
    persist(({ settings, projectId }) => {
      if (projectId === null) {
        return { disabledSkills: [...withSkillDisabled(settings.disabledSkills, name, disabled)] };
      }
      const switches = { ...settings.projectSettingsOverrides[projectId]?.disabledSkills };
      const inheritedOff = isSkillDisabled(settings.disabledSkills, name);
      for (const key of Object.keys(switches)) {
        if (key.toLowerCase() === name.toLowerCase()) delete switches[key];
      }
      // A switch that matches the environment is not an override.
      if (disabled !== inheritedOff) switches[name] = disabled;
      return projectOverridePatch(settings, projectId, "disabledSkills", switches);
    });

  return (
    <>
      <SettingsSection
        {...searchableSetting("tools-skills")}
        hideTitle
        variant="plain"
        className="px-3 sm:px-4"
      >
        <div className="flex items-center gap-2">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              size="sm"
              placeholder="Filter skills"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter skills"
            />
          </InputGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Rescan skills"
                  disabled={refreshing || environmentId === null}
                  onClick={() => void refresh(true)}
                />
              }
            >
              <RefreshCwIcon className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
            </TooltipTrigger>
            <TooltipPopup side="top">Rescan skill folders</TooltipPopup>
          </Tooltip>
        </div>
      </SettingsSection>
      {rows.length === 0 ? (
        <SettingsSection title="Skills">
          <SettingsRow
            title={refreshing ? "Looking for skills…" : "No skills found"}
            description={
              refreshing
                ? undefined
                : "Agents load skills from folders like ~/.agents/skills and .claude/skills. Add one there and rescan."
            }
          />
        </SettingsSection>
      ) : groups.length === 0 ? (
        <SettingsSection title="Skills">
          <SettingsRow title={`No skills match “${query.trim()}”`} />
        </SettingsSection>
      ) : (
        groups.map(({ group, rows: groupRows }) => (
          <SettingsSection key={group} title={SKILL_GROUP_LABELS[group]}>
            {groupRows.map((row) => (
              <SkillSettingsRow
                key={row.name}
                row={row}
                disabled={isSkillDisabled(disabledSkills, row.name)}
                overridden={
                  isProjectScope &&
                  targets.some(
                    (candidate) =>
                      candidate.projectId !== null &&
                      Object.hasOwn(
                        connectedEnvironments.find(
                          (environment) => environment.environmentId === candidate.environmentId,
                        )?.serverConfig?.settings.projectSettingsOverrides[candidate.projectId]
                          ?.disabledSkills ?? {},
                        row.name,
                      ),
                  )
                }
                showProviders={skillReachesSomeProviders(row, enabledProviders.length)}
                canWrite={canWrite}
                onChange={(enabled) => setSkillDisabled(row.name, !enabled)}
              />
            ))}
          </SettingsSection>
        ))
      )}
      <p className="px-3 text-xs text-muted-foreground sm:px-4">
        Turning a skill off hides it from Claude, Codex and OpenCode, and from the composer's skill
        menu. Other agents may still load it on their own. Changes apply to new sessions.
      </p>
    </>
  );
}

function SkillSettingsRow({
  row,
  disabled,
  overridden,
  showProviders,
  canWrite,
  onChange,
}: {
  readonly row: SkillRow;
  readonly disabled: boolean;
  readonly overridden: boolean;
  readonly showProviders: boolean;
  readonly canWrite: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const lockedOff = row.disabledByProvider;
  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono">{row.name}</span>
          {overridden ? (
            <Badge variant="info" size="sm">
              This project
            </Badge>
          ) : null}
        </span>
      }
      description={
        lockedOff
          ? "Turned off in the agent's own settings."
          : (row.description ?? row.paths[0] ?? undefined)
      }
      className={disabled || lockedOff ? "[&_h3]:text-muted-foreground" : undefined}
      control={
        <>
          {showProviders ? (
            <span className="flex items-center gap-1">
              {row.providers.map((provider) => (
                <Tooltip key={provider.instanceId}>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <ProviderInstanceIcon
                      driverKind={provider.driver}
                      displayName={provider.displayName}
                      badgeContent="none"
                      className="size-4"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{provider.displayName}</TooltipPopup>
                </Tooltip>
              ))}
            </span>
          ) : null}
          <Switch
            aria-label={`${row.name} skill`}
            checked={!disabled && !lockedOff}
            disabled={!canWrite || lockedOff}
            onCheckedChange={onChange}
          />
        </>
      }
    />
  );
}

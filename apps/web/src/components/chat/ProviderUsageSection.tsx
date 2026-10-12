import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useNowMinute } from "../../hooks/useNowMinute";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { TurnThroughput } from "../../lib/turnThroughput";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItemLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import {
  selectHiddenUsageProviderIds,
  useProviderUsagePreferencesStore,
} from "../../providerUsagePreferencesStore";
import { providerQuotaStatus, formatStatusPercent, selectThreadUsage } from "./providerUsage.logic";

function UsageDetail({
  children,
  description,
  className,
}: {
  children: ReactNode;
  description: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="group"
            tabIndex={0}
            aria-label={description}
            className={cn(
              "flex min-w-0 items-center justify-between gap-2 rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}

function instanceLabel(
  entry: ProviderInstanceEntry,
  entries: ReadonlyArray<ProviderInstanceEntry>,
) {
  return entries.some(
    (other) => other.instanceId !== entry.instanceId && other.displayName === entry.displayName,
  )
    ? `${entry.displayName} (${entry.instanceId})`
    : entry.displayName;
}

function ProviderQuotaGroup({
  entry,
  label,
  now,
  disconnected,
}: {
  entry: ProviderInstanceEntry;
  label: string;
  now: number;
  disconnected: boolean;
}) {
  const quota = providerQuotaStatus(entry.snapshot, now, disconnected);
  const unavailable = !entry.isAvailable
    ? "This provider is unavailable in the current environment."
    : quota.unavailable;
  const summary =
    unavailable !== null
      ? `${label}: ${unavailable}`
      : [
          `${label} subscription usage.`,
          ...quota.windows.map(
            (window) =>
              `${window.label}: ${window.usedPercent === null ? "awaiting refreshed usage" : `${formatStatusPercent(window.usedPercent)} used`}.`,
          ),
          quota.stale ? "Last reported usage; refresh failed." : "",
        ]
          .filter(Boolean)
          .join(" ");
  return (
    <div data-provider-usage-instance={entry.instanceId} className="shrink-0">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={150}
          render={<ThreadDetailsControl part="usage" aria-label={summary} />}
        >
          <span aria-hidden="true" className="relative flex items-center">
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              acpRegistryAgentId={entry.acpRegistryAgentId}
              acpRegistryIconUrl={entry.acpRegistryIconUrl}
              showBadge={!entry.isDefault}
              iconClassName="size-5"
            />
            {quota.stale && unavailable === null ? (
              <span className="absolute -top-1 -left-1 size-1.5 rounded-full bg-warning" />
            ) : null}
          </span>
          <span
            aria-hidden="true"
            className="flex min-w-7 flex-col text-left text-xs leading-3.5 tabular-nums"
          >
            {unavailable !== null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              quota.windows.slice(0, 2).map((window) => (
                <span
                  key={window.id}
                  className={
                    window.usedPercent !== null && window.usedPercent >= 90
                      ? "text-warning"
                      : undefined
                  }
                >
                  {formatStatusPercent(window.usedPercent)}
                </span>
              ))
            )}
          </span>
          {unavailable === null && quota.windows.length > 2 ? (
            <span aria-hidden="true" className="self-start pt-1 text-3xs text-muted-foreground">
              +{quota.windows.length - 2}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverPopup side="top" width="sm" padding="compact" aria-label={`${label} usage details`}>
          <div className="space-y-3 text-xs">
            <PopoverTitle>{label}</PopoverTitle>
            {unavailable !== null ? (
              <p className="text-muted-foreground">{unavailable}</p>
            ) : (
              <>
                <p className="text-muted-foreground">Subscription quota used</p>
                {quota.windows.map((window) => {
                  const percent = formatStatusPercent(window.usedPercent);
                  return (
                    <div key={window.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <span>{window.label}</span>
                        <span className="tabular-nums">{percent}</span>
                      </div>
                      <span
                        role="progressbar"
                        aria-label={`${label} · ${window.label} quota used`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={window.usedPercent ?? undefined}
                        aria-valuetext={
                          window.usedPercent === null
                            ? "Awaiting refreshed usage"
                            : `${percent} used`
                        }
                        className="block h-1 w-full overflow-hidden rounded-full bg-muted-foreground/15"
                      >
                        {window.usedPercent !== null ? (
                          <span
                            className={
                              window.usedPercent >= 90
                                ? "block h-full bg-warning"
                                : "block h-full bg-muted-foreground/60"
                            }
                            style={{ width: `${window.usedPercent}%` }}
                          />
                        ) : null}
                      </span>
                      {window.usedPercent === null ? (
                        <p className="text-muted-foreground">Awaiting refreshed usage</p>
                      ) : null}
                      {window.resetsAt ? (
                        <p className="text-muted-foreground">
                          Resets {new Date(window.resetsAt).toLocaleString()}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {quota.stale ? (
                  <p className="text-warning">Last reported usage · refresh failed</p>
                ) : null}
                {quota.checkedAt ? (
                  <p className="text-muted-foreground">
                    Last reported {new Date(quota.checkedAt).toLocaleString()}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

/** Quotas cover visible enabled accounts; thread metrics stay scoped to the picker. */
export function ProviderUsageSection({
  host,
  environmentId,
  providers,
  catalogKnown,
  selectedModel,
  multipleModels,
  context,
  contextModelSelection,
  showContext,
  throughput,
  disconnected,
}: {
  host: HTMLDivElement | null;
  environmentId: EnvironmentId;
  providers: ReadonlyArray<ProviderInstanceEntry>;
  catalogKnown: boolean;
  selectedModel: ModelSelection;
  multipleModels: boolean;
  context: ContextWindowSnapshot | null;
  contextModelSelection: ModelSelection | null;
  showContext: boolean;
  throughput: TurnThroughput | null;
  disconnected: boolean;
}) {
  const minute = useNowMinute();
  const hiddenIds = useProviderUsagePreferencesStore((state) =>
    selectHiddenUsageProviderIds(state, environmentId),
  );
  const setHidden = useProviderUsagePreferencesStore((state) => state.setHidden);
  const showAll = useProviderUsagePreferencesStore((state) => state.showAll);
  const enabledProviders = providers.filter((entry) => entry.enabled);
  const visibleProviders = enabledProviders.filter(
    (entry) => !hiddenIds.includes(entry.instanceId),
  );
  const selectedProvider = multipleModels
    ? null
    : (visibleProviders.find(
        (entry) =>
          entry.instanceId === selectedModel.instanceId && entry.enabled && entry.isAvailable,
      ) ?? null);
  const threadUsage = selectThreadUsage({
    provider: selectedProvider?.snapshot ?? null,
    selectedModel,
    context,
    contextModelSelection,
    throughput,
  });
  const contextPercent = disconnected ? null : (threadUsage.context?.usedPercentage ?? null);
  const tokensPerSecond = disconnected ? null : threadUsage.tokensPerSecond;
  if (host === null) return null;

  return createPortal(
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage"
      showHeading={false}
    >
      <div
        data-provider-usage-section
        className="min-w-0 text-2xs leading-4 text-muted-foreground tabular-nums"
      >
        <div className="flex min-w-0 items-start gap-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
            {enabledProviders.length === 0 ? (
              <p className="px-1.5 py-2">
                {disconnected
                  ? "Reconnect to see provider usage."
                  : catalogKnown
                    ? "No enabled providers"
                    : "Loading providers…"}
              </p>
            ) : visibleProviders.length === 0 ? (
              <div className="flex min-h-10 flex-wrap items-center gap-x-2 px-1.5">
                <p>All providers hidden</p>
                <ThreadDetailsControl part="meta" onClick={() => showAll(environmentId)}>
                  Show all
                </ThreadDetailsControl>
              </div>
            ) : (
              visibleProviders.map((entry) => (
                <ProviderQuotaGroup
                  key={entry.instanceId}
                  entry={entry}
                  label={instanceLabel(entry, enabledProviders)}
                  now={Date.parse(`${minute}:00Z`)}
                  disconnected={disconnected}
                />
              ))
            )}
          </div>
          {enabledProviders.length > 0 ? (
            <div className="shrink-0 pt-2">
              {/* A modal menu dismisses the containing card across this DOM-only portal. */}
              <Menu modal={false}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <MenuTrigger
                        render={
                          <ThreadDetailsControl part="icon" aria-label="Choose visible providers" />
                        }
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </MenuTrigger>
                    }
                  />
                  <TooltipPopup>Show or hide providers</TooltipPopup>
                </Tooltip>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuGroupLabel>Shown in this sidebar</MenuGroupLabel>
                    {enabledProviders.map((entry) => (
                      <MenuCheckboxItem
                        key={entry.instanceId}
                        checked={!hiddenIds.includes(entry.instanceId)}
                        onCheckedChange={(checked) =>
                          setHidden(environmentId, entry.instanceId, !checked)
                        }
                        closeOnClick={false}
                      >
                        <MenuItemLabel>{instanceLabel(entry, enabledProviders)}</MenuItemLabel>
                      </MenuCheckboxItem>
                    ))}
                  </MenuGroup>
                </MenuPopup>
              </Menu>
            </div>
          ) : null}
        </div>
        {selectedProvider ? (
          <div
            data-thread-usage
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 px-1.5"
          >
            {showContext ? (
              <UsageDetail
                description={`${instanceLabel(selectedProvider, enabledProviders)} · ${selectedModel.model}. ${
                  contextPercent !== null && threadUsage.context
                    ? `Context window: ${formatStatusPercent(contextPercent)} used (${formatContextWindowTokens(threadUsage.context.usedTokens)} of ${formatContextWindowTokens(threadUsage.context.maxTokens ?? null)} tokens).`
                    : "Context percentage is unavailable until the selected provider and model report usage and a context limit for this thread."
                }`}
              >
                <span>Context</span>
                <span>{formatStatusPercent(contextPercent)}</span>
              </UsageDetail>
            ) : null}
            <UsageDetail
              description={`${instanceLabel(selectedProvider, enabledProviders)} · ${selectedModel.model}. ${
                tokensPerSecond === null
                  ? "Turn average is available after this thread's selected provider and model complete a turn with token usage and timing. Live generation speed is not reported."
                  : "Average output tokens per second for this thread's latest completed turn on the selected provider and model, including reasoning tokens and time spent on tools or waiting. This is not live model generation speed."
              }`}
            >
              <span>Turn average</span>
              <span>
                {tokensPerSecond === null ? "—" : Number(tokensPerSecond.toFixed(1))} tok/s
              </span>
            </UsageDetail>
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>,
    host,
  );
}

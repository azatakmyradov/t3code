import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { GaugeIcon, MoreHorizontalIcon } from "lucide-react";
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
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
  THREAD_DETAILS_PANEL_TEXT_CLASS,
} from "./threadDetailsPanelStyles";
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

function UsageLabel({ children, tooltip = true }: { children: string; tooltip?: boolean }) {
  const label = (
    <div
      className={cn(
        "min-w-0 flex-1 truncate",
        THREAD_DETAILS_PANEL_TEXT_CLASS,
        THREAD_DETAILS_PANEL_LABEL_CLASS,
      )}
    >
      {children}
    </div>
  );
  if (!tooltip) return label;
  return (
    <Tooltip>
      <TooltipTrigger render={label} />
      <TooltipPopup side="top">{children}</TooltipPopup>
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
  const identity = (
    <>
      <span aria-hidden="true">
        <ProviderInstanceIcon
          driverKind={entry.driverKind}
          displayName={entry.displayName}
          acpRegistryAgentId={entry.acpRegistryAgentId}
          acpRegistryIconUrl={entry.acpRegistryIconUrl}
          iconClassName={THREAD_DETAILS_PANEL_ICON_CLASS}
        />
      </span>
      <UsageLabel tooltip={unavailable === null}>{label}</UsageLabel>
    </>
  );
  return (
    <div data-provider-usage-instance={entry.instanceId} className="min-w-0">
      {unavailable !== null ? (
        <UsageDetail
          description={`${label}: ${unavailable}`}
          className={cn("h-8 py-0", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}
        >
          {identity}
          <span className="shrink-0">Unavailable</span>
        </UsageDetail>
      ) : (
        <>
          <div
            className={cn("flex h-8 min-w-0 items-center", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}
          >
            {identity}
          </div>
          <div className="space-y-1 ps-9 pe-2.5 pb-1.5">
            {quota.windows.map((window) => {
              const percent = formatStatusPercent(window.usedPercent);
              const description = [
                `${label} · ${window.label}: ${window.usedPercent === null ? "waiting for refreshed usage after reset" : `${percent} used`}.`,
                window.resetsAt ? `Resets ${new Date(window.resetsAt).toLocaleString()}.` : "",
                quota.checkedAt
                  ? `Last reported ${new Date(quota.checkedAt).toLocaleString()}.`
                  : "",
                quota.stale ? "The latest refresh failed; this is the last reported usage." : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <UsageDetail key={window.id} description={description} className="block space-y-1">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{window.shortLabel}</span>
                    <span className="shrink-0 text-foreground/80">{percent}</span>
                  </div>
                  <span
                    role="progressbar"
                    aria-label={`${label} · ${window.label} quota used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={window.usedPercent ?? undefined}
                    aria-valuetext={
                      window.usedPercent === null ? "Awaiting refreshed usage" : `${percent} used`
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
                </UsageDetail>
              );
            })}
            {quota.stale ? <p className="py-1">Last reported usage · refresh failed</p> : null}
          </div>
        </>
      )}
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
      headingIcon={<GaugeIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden="true" />}
      actions={
        enabledProviders.length > 0 ? (
          <Menu>
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
        ) : undefined
      }
    >
      <div
        data-provider-usage-section
        className="min-w-0 text-2xs leading-4 text-muted-foreground tabular-nums"
      >
        {enabledProviders.length === 0 ? (
          <p className="ps-9 pe-2.5 py-1.5">
            {disconnected
              ? "Reconnect to see provider usage."
              : catalogKnown
                ? "No enabled providers"
                : "Loading providers…"}
          </p>
        ) : visibleProviders.length === 0 ? (
          <div className="flex items-center justify-between gap-2 ps-9 pe-2.5 py-1">
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
        {selectedProvider ? (
          <div data-thread-usage className="min-w-0 space-y-1 ps-9 pe-2.5 pt-2">
            <p className="mb-1 font-medium">Thread usage · selected model</p>
            <UsageLabel>{`${instanceLabel(selectedProvider, enabledProviders)} · ${selectedModel.model}`}</UsageLabel>
            {showContext ? (
              <UsageDetail
                description={
                  contextPercent !== null && threadUsage.context
                    ? `Context window: ${formatStatusPercent(contextPercent)} used (${formatContextWindowTokens(threadUsage.context.usedTokens)} of ${formatContextWindowTokens(threadUsage.context.maxTokens ?? null)} tokens).`
                    : "Context percentage is unavailable until the selected provider and model report usage and a context limit for this thread."
                }
              >
                <span>Context</span>
                <span>{formatStatusPercent(contextPercent)}</span>
              </UsageDetail>
            ) : null}
            <UsageDetail
              description={
                tokensPerSecond === null
                  ? "Turn average is available after this thread's selected provider and model complete a turn with token usage and timing. Live generation speed is not reported."
                  : "Average output tokens per second for this thread's latest completed turn on the selected provider and model, including reasoning tokens and time spent on tools or waiting. This is not live model generation speed."
              }
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

import type { ModelSelection } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useNowMinute } from "../../hooks/useNowMinute";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { TurnThroughput } from "../../lib/turnThroughput";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { providerQuotaStatus, formatStatusPercent, selectThreadUsage } from "./providerUsage.logic";

function UsageDetail({ children, description }: { children: ReactNode; description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="group"
            tabIndex={0}
            aria-label={description}
            className="flex min-w-0 items-center justify-between gap-2 rounded-sm py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}

function UsageLabel({ children }: { children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div className="min-w-0 truncate text-xs font-medium text-foreground/80" />}
      >
        {children}
      </TooltipTrigger>
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
  const state = !entry.enabled ? "Disabled" : !entry.isAvailable ? "Unavailable" : null;
  const quota = providerQuotaStatus(entry.snapshot, now, disconnected);
  return (
    <div
      data-provider-usage-instance={entry.instanceId}
      className="min-w-0 not-first:border-t not-first:border-border/40 not-first:pt-2"
    >
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <UsageLabel>{label}</UsageLabel>
        {state ? <span className="shrink-0">{state}</span> : null}
      </div>
      {state === null ? (
        <>
          {quota.windows.map((window) => {
            const percent = formatStatusPercent(window.usedPercent);
            const description = [
              `${label} · ${window.label}: ${window.usedPercent === null ? "waiting for refreshed usage after reset" : `${percent} used`}.`,
              window.resetsAt ? `Resets ${new Date(window.resetsAt).toLocaleString()}.` : "",
              quota.checkedAt ? `Last reported ${new Date(quota.checkedAt).toLocaleString()}.` : "",
              quota.stale ? "The latest refresh failed; this is the last reported usage." : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <UsageDetail key={window.id} description={description}>
                <span className="min-w-0 flex-1 truncate">{window.shortLabel}</span>
                <span
                  role="progressbar"
                  aria-label={`${label} · ${window.label} quota used`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={window.usedPercent ?? undefined}
                  aria-valuetext={
                    window.usedPercent === null ? "Awaiting refreshed usage" : `${percent} used`
                  }
                  className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted-foreground/20"
                >
                  {window.usedPercent !== null ? (
                    <span
                      className={
                        window.usedPercent >= 90
                          ? "block h-full bg-warning"
                          : "block h-full bg-muted-foreground/70"
                      }
                      style={{ width: `${window.usedPercent}%` }}
                    />
                  ) : null}
                </span>
                <span className="w-9 shrink-0 text-end">{percent}</span>
              </UsageDetail>
            );
          })}
          {quota.unavailable !== null ? (
            <UsageDetail description={quota.unavailable}>
              <span>Quota</span>
              <span>Unavailable</span>
            </UsageDetail>
          ) : quota.stale ? (
            <p className="py-1">Last reported usage · refresh failed</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Quotas cover every configured account; thread metrics stay scoped to the picker. */
export function ProviderUsageSection({
  host,
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
  const selectedProvider = multipleModels
    ? null
    : (providers.find(
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
    <ThreadDetailsSection headingId="thread-details-usage-heading" title="Provider usage">
      <div
        data-provider-usage-section
        className="min-w-0 space-y-2 px-2.5 text-2xs leading-4 text-muted-foreground tabular-nums"
      >
        {providers.length === 0 ? (
          <p className="py-1">
            {disconnected
              ? "Reconnect to see provider usage."
              : catalogKnown
                ? "No providers configured"
                : "Loading providers…"}
          </p>
        ) : (
          providers.map((entry) => (
            <ProviderQuotaGroup
              key={entry.instanceId}
              entry={entry}
              label={instanceLabel(entry, providers)}
              now={Date.parse(`${minute}:00Z`)}
              disconnected={disconnected}
            />
          ))
        )}
        {selectedProvider ? (
          <div data-thread-usage className="min-w-0 border-t border-border/40 pt-2">
            <p className="mb-1 font-medium">Thread usage · selected model</p>
            <UsageLabel>{`${instanceLabel(selectedProvider, providers)} · ${selectedModel.model}`}</UsageLabel>
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

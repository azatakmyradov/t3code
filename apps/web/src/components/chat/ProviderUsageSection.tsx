import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { TurnThroughput } from "../../lib/turnThroughput";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  providerQuotaStatus,
  formatStatusPercent,
  selectProviderUsage,
} from "./providerUsage.logic";

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

/** Keep the picker as the source of truth while rendering usage in the workspace card. */
export function ProviderUsageSection({
  host,
  provider,
  selectedModel,
  multipleModels,
  context,
  contextModelSelection,
  showContext,
  throughput,
  disconnected,
}: {
  host: HTMLDivElement | null;
  provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName" | "usageLimits"> | null;
  selectedModel: ModelSelection;
  multipleModels: boolean;
  context: ContextWindowSnapshot | null;
  contextModelSelection: ModelSelection | null;
  showContext: boolean;
  throughput: TurnThroughput | null;
  disconnected: boolean;
}) {
  const minute = useNowMinute();
  const selectedUsage = selectProviderUsage({
    provider,
    selectedModel,
    context,
    contextModelSelection,
    throughput,
  });
  const quota = providerQuotaStatus(
    selectedUsage.provider,
    Date.parse(`${minute}:00Z`),
    disconnected,
  );
  const contextPercent = disconnected ? null : (selectedUsage.context?.usedPercentage ?? null);
  const tokensPerSecond = disconnected ? null : selectedUsage.tokensPerSecond;
  if (host === null) return null;

  return createPortal(
    <ThreadDetailsSection headingId="thread-details-usage-heading" title="Provider usage">
      <div
        data-provider-usage-section
        className="min-w-0 px-2.5 text-2xs leading-4 text-muted-foreground tabular-nums"
      >
        {multipleModels ? (
          <p className="py-1">Select one model to see its usage.</p>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger
                render={<div className="mb-1 truncate text-xs font-medium text-foreground/80" />}
              >
                {selectedUsage.provider?.displayName ?? selectedModel.instanceId}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {selectedUsage.provider?.displayName ?? selectedModel.instanceId}
              </TooltipPopup>
            </Tooltip>
            {quota.windows.map((window) => {
              const percent = formatStatusPercent(window.usedPercent);
              const description = [
                `${window.label}: ${window.usedPercent === null ? "waiting for refreshed usage after reset" : `${percent} used`}.`,
                window.resetsAt ? `Resets ${new Date(window.resetsAt).toLocaleString()}.` : "",
                quota.checkedAt
                  ? `Last reported ${new Date(quota.checkedAt).toLocaleString()}.`
                  : "",
                quota.stale ? "The latest refresh failed; this is the last reported usage." : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <UsageDetail key={window.id} description={description}>
                  <span className="min-w-0 flex-1 truncate">{window.shortLabel}</span>
                  <span
                    role="progressbar"
                    aria-label={`${window.label} quota used`}
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
            {showContext ? (
              <UsageDetail
                description={
                  contextPercent !== null && selectedUsage.context
                    ? `Context window: ${formatStatusPercent(contextPercent)} used (${formatContextWindowTokens(selectedUsage.context.usedTokens)} of ${formatContextWindowTokens(selectedUsage.context.maxTokens ?? null)} tokens).`
                    : "Context percentage is unavailable until the provider reports usage and a context limit."
                }
              >
                <span>Context</span>
                <span>{formatStatusPercent(contextPercent)}</span>
              </UsageDetail>
            ) : null}
            <UsageDetail
              description={
                tokensPerSecond === null
                  ? "Turn average is available after a completed turn reports complete token usage and timing. Live generation speed is not reported."
                  : "Average output tokens per second for the latest completed turn, including reasoning tokens and time spent on tools or waiting. This is not live model generation speed."
              }
            >
              <span>Turn average</span>
              <span>
                {tokensPerSecond === null ? "—" : Number(tokensPerSecond.toFixed(1))} tok/s
              </span>
            </UsageDetail>
          </>
        )}
      </div>
    </ThreadDetailsSection>,
    host,
  );
}

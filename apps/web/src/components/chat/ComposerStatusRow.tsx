import type { ServerProvider } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerQuotaStatus, formatStatusPercent } from "./ComposerStatusRow.logic";

function StatusDetail({ children, description }: { children: ReactNode; description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="group"
            tabIndex={0}
            aria-label={description}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}

/** A read-only summary of provider reports, with no extra polling or agent requests. */
export function ComposerStatusRow({
  provider,
  context,
  showContext,
  turnTokensPerSecond,
  disconnected,
}: {
  provider: Pick<ServerProvider, "usageLimits"> | null;
  context: ContextWindowSnapshot | null;
  showContext: boolean;
  turnTokensPerSecond: number | null;
  disconnected: boolean;
}) {
  const minute = useNowMinute();
  const quota = composerQuotaStatus(provider, Date.parse(`${minute}:00Z`), disconnected);
  const contextPercent = disconnected ? null : (context?.usedPercentage ?? null);
  const throughput = disconnected ? null : turnTokensPerSecond;

  return (
    <div
      data-chat-composer-status-row="true"
      className="relative z-10 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-1.5 pb-1 text-2xs leading-4 text-muted-foreground tabular-nums"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {quota.windows.map((window) => {
          const percent = formatStatusPercent(window.usedPercent);
          const description = [
            `${window.label}: ${window.usedPercent === null ? "waiting for refreshed usage after reset" : `${percent} used`}.`,
            window.resetsAt ? `Resets ${new Date(window.resetsAt).toLocaleString()}.` : "",
            quota.checkedAt ? `Last reported ${new Date(quota.checkedAt).toLocaleString()}.` : "",
            quota.stale ? "The latest refresh failed; this is the last reported usage." : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <StatusDetail key={window.id} description={description}>
              <span>{window.shortLabel}</span>
              <span
                role="progressbar"
                aria-label={`${window.label} quota used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={window.usedPercent ?? undefined}
                aria-valuetext={
                  window.usedPercent === null ? "Awaiting refreshed usage" : `${percent} used`
                }
                className="h-0.5 w-8 overflow-hidden rounded-full bg-muted-foreground/20"
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
              <span>{percent}</span>
            </StatusDetail>
          );
        })}
        {quota.unavailable !== null ? (
          <StatusDetail description={quota.unavailable}>Quota —</StatusDetail>
        ) : quota.stale ? (
          <span>stale</span>
        ) : null}
      </div>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        {showContext ? (
          <StatusDetail
            description={
              contextPercent !== null && context
                ? `Context window: ${formatStatusPercent(contextPercent)} used (${formatContextWindowTokens(context.usedTokens)} of ${formatContextWindowTokens(context.maxTokens ?? null)} tokens).`
                : "Context percentage is unavailable until the provider reports usage and a context limit."
            }
          >
            {formatStatusPercent(contextPercent)} context
          </StatusDetail>
        ) : null}
        {showContext ? <span aria-hidden>·</span> : null}
        <StatusDetail
          description={
            throughput === null
              ? "Turn average is available after a completed turn reports complete token usage and timing. Live generation speed is not reported."
              : "Average output tokens per second for the latest completed turn, including reasoning tokens and time spent on tools or waiting. This is not live model generation speed."
          }
        >
          {throughput === null ? "—" : Number(throughput.toFixed(1))} tok/s turn avg
        </StatusDetail>
      </div>
    </div>
  );
}

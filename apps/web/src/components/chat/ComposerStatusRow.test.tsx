// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { TooltipProvider } from "../ui/tooltip";
import { ComposerStatusRow } from "./ComposerStatusRow";

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-10-10T12:00" }));

it("updates reported metrics and clears another account's values when switching or disconnecting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const context = deriveLatestContextWindowSnapshot([], {
    usedTokens: 10_000,
    maxTokens: 200_000,
    updatedAt: "2026-10-10T11:59:00Z",
  });
  const render = async (reported: boolean, disconnected = false, showContext = true) => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <ComposerStatusRow
            provider={
              reported
                ? {
                    usageLimits: {
                      checkedAt: "2026-10-10T11:59:00Z",
                      windows: [
                        {
                          id: "primary",
                          kind: "session",
                          label: "Session",
                          windowDurationMins: 300,
                          usedPercent: 12,
                        },
                      ],
                    },
                  }
                : null
            }
            context={reported ? context : null}
            showContext={showContext}
            turnTokensPerSecond={reported ? 91 : null}
            disconnected={disconnected}
          />
        </TooltipProvider>,
      );
    });
  };
  try {
    await render(true);
    expect(container.textContent).toContain("5h12%");
    expect(container.textContent).toContain("5% context");
    expect(container.textContent).toContain("91 tok/s turn avg");
    await render(false);
    expect(container.textContent).toContain("Quota —");
    expect(container.textContent).toContain("— context");
    expect(container.textContent).toContain("— tok/s turn avg");
    expect(container.textContent).not.toContain("12%");
    await render(true, true);
    expect(container.textContent).not.toContain("12%");
    expect(container.textContent).not.toContain("91 tok/s");
    await render(true, false, false);
    expect(container.textContent).not.toContain("context");
    expect(container.textContent).toContain("91 tok/s turn avg");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

import { InfoIcon } from "lucide-react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

function notice(title: string, group?: ComposerBannerStackItem["group"]): ComposerBannerStackItem {
  return { id: title, variant: "default", icon: <InfoIcon />, title, ...(group ? { group } : {}) };
}

it("puts machine notices first, whatever order the notices arrive in", async () => {
  await using screen = await render(
    <ComposerBannerStack items={[notice("Branch changed"), notice("Offline", "environment")]} />,
  );

  expect(screen.container.textContent).toBe("OfflineBranch changed");
});

it("leaves the next attachment its own top edge when there are no notices", async () => {
  await using screen = await render(
    <ComposerBanner.Column>
      <ComposerBannerStack items={[]} />
      <ComposerBanner.Attachment>
        <ComposerBanner.Root data-testid="drawer">Approval</ComposerBanner.Root>
      </ComposerBanner.Attachment>
    </ComposerBanner.Column>,
  );

  const surface = getComputedStyle(screen.getByTestId("drawer").element(), "::before");
  expect(surface.borderTopWidth).toBe("1px");
  expect(surface.borderTopLeftRadius).not.toBe("0px");
});

it("commits a dismissal when the thread switches during the exit transition", async () => {
  const onDismiss = vi.fn();
  const item: ComposerBannerStackItem = {
    id: "notice",
    variant: "info",
    icon: <InfoIcon />,
    title: "Thread A notice",
    dismissLabel: "Dismiss notice",
    onDismiss,
  };
  await using screen = await render(<ComposerBannerStack key="thread-a" items={[item]} />);

  await userEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  // The composer keys the stack by thread, so switching threads remounts it mid-exit.
  await screen.rerender(<ComposerBannerStack key="thread-b" items={[]} />);

  await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
});

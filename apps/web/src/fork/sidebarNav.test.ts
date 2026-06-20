import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { SETTINGS_NAV_ITEMS } from "../components/settings/SettingsSidebarNav";
import { shouldShowJiraSidebarItem } from "./sidebarNav";

describe("fork sidebar navigation", () => {
  it("hides the Jira sidebar item while unconfigured", () => {
    expect(shouldShowJiraSidebarItem(DEFAULT_SERVER_SETTINGS)).toBe(false);
  });

  it("shows the Jira sidebar item once credentials are configured", () => {
    expect(
      shouldShowJiraSidebarItem({
        ...DEFAULT_SERVER_SETTINGS,
        fork: {
          ...DEFAULT_SERVER_SETTINGS.fork,
          jira: {
            ...DEFAULT_SERVER_SETTINGS.fork.jira,
            siteUrl: "https://example.atlassian.net",
            email: "ada@example.com",
            apiToken: "",
            apiTokenRedacted: true,
          },
        },
      }),
    ).toBe(true);
  });

  it("keeps Settings -> Jira visible for setup", () => {
    expect(SETTINGS_NAV_ITEMS.some((item) => item.to === "/settings/jira")).toBe(true);
  });
});

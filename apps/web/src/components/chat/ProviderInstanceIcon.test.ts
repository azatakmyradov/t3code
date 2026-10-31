import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  providerTextColor,
  resolveProviderInstanceAcpRegistryIconUrl,
} from "./ProviderInstanceIcon";

it.each(["constructor", "toString", "unknown-driver"])(
  "uses the default label color for the unknown driver %s",
  (driver) => {
    expect(providerTextColor(ProviderDriverKind.make(driver))).toEqual({});
  },
);

describe("resolveProviderInstanceAcpRegistryIconUrl", () => {
  it("uses allowlisted catalog metadata and rejects untrusted overrides", () => {
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "kilo",
        iconUrl: "https://cdn.agentclientprotocol.com/registry/icons/kilo.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/icons/kilo.svg");
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "generic-agent",
        iconUrl: "https://example.com/not-official.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/generic-agent.svg");
  });
});

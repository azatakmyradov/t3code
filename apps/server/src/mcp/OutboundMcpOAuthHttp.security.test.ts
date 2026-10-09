// @effect-diagnostics nodeBuiltinImport:off - fake Node HTTP streams exercise the transport boundary without network access.
import * as NodeEvents from "node:events";
import type * as NodeHttp from "node:http";
import type * as NodeHttps from "node:https";
import * as NodeStream from "node:stream";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

import * as OutboundHttp from "./OutboundMcpOAuthHttp.ts";

const network = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("node:http", () => ({ request: network.request }));

class FakeRequest extends NodeEvents.EventEmitter {
  readonly setTimeout = vi.fn(() => this);
  readonly end = vi.fn(() => {});
  readonly destroy = vi.fn((error?: Error) => {
    if (error) this.emit("error", error);
    return this;
  });
}

function respond(status = 200, body = "ok", rawHeaders: string[] = []) {
  const request = new FakeRequest();
  const incoming = Object.assign(new NodeStream.PassThrough(), { statusCode: status, rawHeaders });
  network.request.mockImplementation(
    (
      _url: URL,
      _options: NodeHttps.RequestOptions,
      callback: (message: NodeHttp.IncomingMessage) => void,
    ) => {
      request.end.mockImplementation(() => {
        queueMicrotask(() => {
          callback(incoming as unknown as NodeHttp.IncomingMessage);
          incoming.end(body);
        });
      });
      return request;
    },
  );
  return { request, incoming };
}

beforeEach(() => {
  vi.resetAllMocks();
  network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});

describe("outbound MCP OAuth network security", () => {
  it("rejects private, special-use and IPv4-carrying transition addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:8.8.8.8",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "ff00::1",
      "64:ff9b::7f00:1",
      "64:ff9b:1::a00:1",
      "2001::1",
      "2001:db8::1",
      "2002:7f00:1::1",
      "3fff::1",
      "not-an-address",
    ]) {
      expect(OutboundHttp.isPublicAddress(address), address).toBe(false);
    }
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "100.63.255.255",
      "172.32.0.1",
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
    ]) {
      expect(OutboundHttp.isPublicAddress(address), address).toBe(true);
    }
  });

  it("rejects insecure URLs, credentials, fragments and alternate loopback encodings", () => {
    for (const url of [
      "http://mcp.example/mcp",
      "https://user:password@mcp.example/mcp",
      "https://mcp.example/mcp#fragment",
      "https://127.1/mcp",
      "https://2130706433/mcp",
      "https://0x7f000001/mcp",
      "https://[::ffff:7f00:1]/mcp",
      "https://localhost/mcp",
      "https://sub.localhost/mcp",
      "file:///tmp/metadata",
      "https://10.0.0.1/mcp",
    ]) {
      expect(() => OutboundHttp.canonicalResourceUrl(url), url).toThrow();
    }
    expect(OutboundHttp.canonicalResourceUrl("HTTPS://MCP.EXAMPLE:443/a/mcp?tenant=one")).toBe(
      "https://mcp.example/a/mcp?tenant=one",
    );
  });

  it("allows loopback HTTP only under the explicit development policy", () => {
    expect(() => OutboundHttp.canonicalResourceUrl("http://127.0.0.1:1234/mcp")).toThrow();
    expect(OutboundHttp.canonicalResourceUrl("http://127.0.0.1:1234/mcp", true)).toBe(
      "http://127.0.0.1:1234/mcp",
    );
    expect(OutboundHttp.canonicalResourceUrl("http://[::1]:1234/mcp", true)).toBe(
      "http://[::1]:1234/mcp",
    );
    expect(() => OutboundHttp.canonicalResourceUrl("http://10.0.0.1:1234/mcp", true)).toThrow();
  });

  it.effect("rejects a DNS result containing any private address before connecting", () =>
    Effect.gen(function* () {
      network.lookup.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]);
      const http = yield* OutboundHttp.OutboundMcpOAuthHttp;
      expect(yield* Effect.flip(http.fetch("https://mcp.example/mcp"))).toMatchObject({
        code: "unsafe_url",
      });
      expect(network.request).not.toHaveBeenCalled();
    }).pipe(Effect.provide(OutboundHttp.layer)),
  );

  it.effect("pins checked DNS results and cannot be rerouted by a Host header", () =>
    Effect.gen(function* () {
      respond();
      const http = yield* OutboundHttp.OutboundMcpOAuthHttp;
      const response = yield* http.fetch("https://mcp.example/mcp", {
        headers: { host: "169.254.169.254", authorization: "Bearer test-grant" },
      });
      expect(yield* Effect.promise(() => response.text())).toBe("ok");
      const [url, options] = network.request.mock.calls[0] as [URL, NodeHttps.RequestOptions];
      expect(url.hostname).toBe("mcp.example");
      expect(options.agent).toBe(false);
      expect(options.headers).toEqual({
        "accept-encoding": "identity",
        authorization: "Bearer test-grant",
      });
      const lookupResult = vi.fn();
      options.lookup?.("rebound.example", {}, lookupResult);
      expect(lookupResult).toHaveBeenCalledWith(null, "8.8.8.8", 4);
      expect(network.lookup).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(OutboundHttp.layer)),
  );

  it.effect("rejects redirects instead of following credentials to a new destination", () =>
    Effect.gen(function* () {
      const { incoming } = respond(302, "", ["Location", "https://different.example/mcp"]);
      const http = yield* OutboundHttp.OutboundMcpOAuthHttp;
      expect(yield* Effect.flip(http.fetch("https://mcp.example/mcp"))).toMatchObject({
        code: "redirect",
      });
      expect(network.request).toHaveBeenCalledTimes(1);
      expect(incoming.destroyed).toBe(true);
    }).pipe(Effect.provide(OutboundHttp.layer)),
  );

  it.effect("contains malformed upstream HTTP statuses without throwing from a callback", () =>
    Effect.gen(function* () {
      const { incoming } = respond(600);
      const http = yield* OutboundHttp.OutboundMcpOAuthHttp;
      expect(yield* Effect.flip(http.fetch("https://mcp.example/mcp"))).toMatchObject({
        code: "network",
      });
      expect(incoming.destroyed).toBe(true);
    }).pipe(Effect.provide(OutboundHttp.layer)),
  );

  it.effect("rejects protocol upgrades and closes their sockets", () =>
    Effect.gen(function* () {
      const request = new FakeRequest();
      const socket = new NodeStream.PassThrough();
      network.request.mockImplementation(() => {
        request.end.mockImplementation(() => {
          queueMicrotask(() => request.emit("upgrade", {}, socket, Buffer.alloc(0)));
        });
        return request;
      });
      const http = yield* OutboundHttp.OutboundMcpOAuthHttp;
      expect(yield* Effect.flip(http.fetch("https://mcp.example/mcp"))).toMatchObject({
        code: "network",
      });
      expect(socket.destroyed).toBe(true);
    }).pipe(Effect.provide(OutboundHttp.layer)),
  );
});

import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { cliReleaseAvailabilityAtom } from "./cliRelease";

const version = "0.0.63";
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck() {
  const atom = cliReleaseAvailabilityAtom(version);
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

const release = (overrides = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  assets: [
    { name: `t3-${version}-linux-x64.tar.gz`, size: 100, state: "uploaded" },
    { name: "SHA256SUMS", size: 100, state: "uploaded" },
  ],
  ...overrides,
});

describe("cliReleaseAvailabilityAtom", () => {
  afterEach(() => fetchMock.mockReset());
  afterAll(() => vi.unstubAllGlobals());

  it("checks the fork GitHub release without consulting npm or sending tracing headers", async () => {
    fetchMock.mockImplementation(async () => Response.json(release()));
    const result = await settledCheck();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/azatakmyradov/t3code/releases/tags/v${version}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => null)).toEqual({
      status: "available",
      assets: [`t3-${version}-linux-x64.tar.gz`, "SHA256SUMS"],
    });
  });

  it.each([404])("reports a missing release as unavailable (%s)", async (status) => {
    fetchMock.mockImplementation(async () => new Response(null, { status }));
    expect(AsyncResult.getOrElse(await settledCheck(), () => null)).toEqual({
      status: "unavailable",
    });
  });

  it.each([{ draft: true }, { tag_name: "v0.0.62" }])(
    "rejects a draft or different release (%j)",
    async (overrides) => {
      fetchMock.mockImplementation(async () => Response.json(release(overrides)));
      expect(AsyncResult.getOrElse(await settledCheck(), () => null)).toEqual({
        status: "unavailable",
      });
    },
  );

  it("does not count empty or incomplete uploads", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        release({
          assets: [
            { name: "empty", size: 0, state: "uploaded" },
            { name: "pending", size: 100, state: "new" },
          ],
        }),
      ),
    );
    expect(AsyncResult.getOrElse(await settledCheck(), () => null)).toEqual({
      status: "available",
      assets: [],
    });
  });

  it.each([403, 429, 500])("keeps HTTP %s distinct from an unpublished release", async (status) => {
    fetchMock.mockImplementation(async () => new Response(null, { status }));
    expect(AsyncResult.isFailure(await settledCheck())).toBe(true);
  });

  it("keeps network failures distinct from an unpublished release", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(AsyncResult.isFailure(await settledCheck())).toBe(true);
  });

  it("rejects malformed release metadata", async () => {
    fetchMock.mockImplementation(async () => Response.json({ assets: [] }));
    expect(AsyncResult.isFailure(await settledCheck())).toBe(true);
  });
});

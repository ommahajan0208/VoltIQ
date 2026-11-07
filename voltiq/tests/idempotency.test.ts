import { afterEach, describe, it, expect, vi } from "vitest";
import { mutateApi } from "../src/lib/api/client";
afterEach(() => vi.unstubAllGlobals());
describe("uncertain job submission retries", () => {
  it("reuses the request key after an interrupted response and allows a later intentional submission", async () => {
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network interrupted"))
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({
            data: { job_id: "job" },
            meta: { schema_version: "2.0", time_basis: "source_local_naive" },
          }),
        ),
      );
    vi.stubGlobal("fetch", upstream);
    const body = { dataset_id: "test-retry-dataset" };
    await expect(mutateApi("/runs", body, "POST", "first-key")).rejects.toThrow(
      /Network/,
    );
    await mutateApi("/runs", body, "POST", "second-key");
    expect(upstream.mock.calls[1][1].headers["Idempotency-Key"]).toBe(
      "first-key",
    );
    await mutateApi("/runs", body, "POST", "third-key");
    expect(upstream.mock.calls[2][1].headers["Idempotency-Key"]).toBe(
      "third-key",
    );
  });
});

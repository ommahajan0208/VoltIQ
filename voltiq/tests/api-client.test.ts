import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, readApi, uploadApi } from "../src/lib/api/client";
import type { Filters } from "../src/lib/types";

const filters = {
  dataset: "ds/a",
  run: "run-a",
  version: "v1",
  from: "2007-05-01T00:00:00",
  to: "2007-05-02T00:00:00",
  scope: "all",
  channel: "active_power_kw",
  detector: "chronos_residual",
  direction: "all",
  review: "all",
  sort: "newest",
  min_score: "",
  cursor: "",
  origin: "",
  horizon: 1,
  model: "",
  forecast_mode: "backtest",
} satisfies Filters;

afterEach(() => vi.unstubAllGlobals());

describe("API client boundaries", () => {
  it("maps custom peak requests to encoded, bounded query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { peak_count: 0 },
        meta: { schema_version: "2.0", time_basis: "source_local_naive" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await readApi<{ peak_count: number }>("peaks", filters);
    expect(response.data.peak_count).toBe(0);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/datasets/ds%2Fa/peaks?");
    expect(url).toContain("dataset_version=v1");
    expect(url).toContain("percentile=0.99");
    expect(url).toContain("min_duration_minutes=15");
    expect((options as RequestInit).signal).toBeUndefined();
  });

  it("turns an API error envelope into a typed ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: { message: "Dataset is not ready", details: { id: "ds1" } } },
          { status: 409 },
        ),
      ),
    );

    await expect(readApi("peaks", filters)).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "Dataset is not ready",
      details: { id: "ds1" },
    } satisfies Partial<ApiError>);
  });

  it("uploads as multipart form data and exposes the returned upload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { id: "upload-1", filename: "readings.csv" },
        meta: { schema_version: "2.0", time_basis: "source_local_naive" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "fixed-upload-key" });

    const upload = await uploadApi(new File(["ts,p\n2007-01-01,1"], "readings.csv"));
    expect(upload.id).toBe("upload-1");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe("POST");
    expect((request.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "fixed-upload-key",
    );
    expect(request.body).toBeInstanceOf(FormData);
  });
});

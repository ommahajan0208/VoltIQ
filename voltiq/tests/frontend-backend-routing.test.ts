import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../src/lib/types";

let readApi: typeof import("../src/lib/api/client").readApi;
let fetchMock: ReturnType<typeof vi.fn>;

const filters = {
  dataset: "ds1",
  run: "run1",
  version: "v1",
  from: "2007-05-01T00:00:00",
  to: "2007-05-02T00:00:00",
  scope: "overnight",
  channel: "active_power_kw",
  detector: "chronos_residual",
  direction: "higher",
  review: "unreviewed",
  sort: "score",
  min_score: "2.5",
  cursor: "cursor-1",
  origin: "2007-05-01T04:00:00",
  horizon: 4,
  model: "persistence",
  forecast_mode: "backtest",
} satisfies Filters;

const envelope = {
  data: [],
  meta: { schema_version: "2.0", time_basis: "source_local_naive" },
};

function requestUrl(call: unknown[]): string {
  const input = call[0];
  return input instanceof Request ? input.url : String(input);
}

afterEach(() => {
  fetchMock.mockClear();
  fetchMock.mockResolvedValue(Response.json(envelope));
});

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_ORIGIN", "http://test.local");
  fetchMock = vi.fn().mockResolvedValue(Response.json(envelope));
  vi.stubGlobal("fetch", fetchMock);
  ({ readApi } = await import("../src/lib/api/client"));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("frontend-to-backend resource routing", () => {
  it.each([
    ["datasets", "/api/v1/datasets"],
    ["runs", "/api/v1/runs"],
    ["dataset", "/api/v1/datasets/ds1"],
    ["run", "/api/v1/runs/run1"],
    ["series", "/api/v1/datasets/ds1/series"],
    ["profiles", "/api/v1/datasets/ds1/profiles"],
    ["quality", "/api/v1/datasets/ds1/quality"],
    ["peaks", "/api/v1/datasets/ds1/peaks"],
    ["overview", "/api/v1/runs/run1/overview"],
    ["scores", "/api/v1/runs/run1/scores"],
    ["events", "/api/v1/runs/run1/events"],
    ["recommendations", "/api/v1/runs/run1/recommendations"],
    ["event", "/api/v1/events/run1"],
    ["forecasts", "/api/v1/runs/run1/forecasts"],
    ["metrics", "/api/v1/runs/run1/metrics"],
    ["jobs", "/api/v1/jobs"],
    ["job", "/api/v1/jobs/run1"],
    ["report", "/api/v1/reports/run1"],
  ])("maps %s to a backend route", async (resource, expectedPath) => {
    await readApi(resource, filters);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl(fetchMock.mock.calls[0])).toContain(expectedPath);
  });

  it("maps frontend display filters to backend query vocabulary", async () => {
    await readApi("events", filters);
    const url = new URL(requestUrl(fetchMock.mock.calls[0]), "http://localhost");
    expect(url.searchParams.get("dataset_version")).toBeNull();
    expect(url.searchParams.get("detector")).toBe("residual");
    expect(url.searchParams.get("direction")).toBe("higher");
    expect(url.searchParams.get("review")).toBe("unreviewed");
    expect(url.searchParams.get("sort")).toBe("peak_score");
    expect(url.searchParams.get("min_peak_score")).toBe("2.5");
    expect(url.searchParams.get("cursor")).toBe("cursor-1");
    expect(url.searchParams.get("from")).toBe(filters.from);
    expect(url.searchParams.get("to")).toBe(filters.to);
  });

  it("uses the explicit resource id for detail reads", async () => {
    await readApi("event", filters, undefined, "event-42");
    expect(requestUrl(fetchMock.mock.calls[0])).toContain("/api/v1/events/event-42");
  });
});

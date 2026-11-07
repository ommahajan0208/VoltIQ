import { describe, it, expect } from "vitest";
import { resourceKey } from "../src/lib/query-keys";
import type { Filters } from "../src/lib/types";
const filters: Filters = {
  dataset: "dataset_a",
  run: "run_a",
  from: "2007-05-01T00:00:00",
  to: "2007-05-08T00:00:00",
  scope: "all",
  channel: "active_power_kw",
  detector: "chronos_residual",
  direction: "all",
  review: "all",
  sort: "newest",
  min_score: "",
  cursor: "",
  origin: "2007-05-03T01:00:00",
  horizon: 16,
  model: "chronos_bolt_tiny",
  forecast_mode: "backtest",
};
describe("scientific cache identity", () => {
  it("separates datasets, immutable versions and runs", () => {
    const key = resourceKey("api", "scores", "v1", filters);
    expect(resourceKey("api", "scores", "v2", filters)).not.toEqual(key);
    expect(
      resourceKey("api", "scores", "v1", { ...filters, run: "run_b" }),
    ).not.toEqual(key);
    expect(
      resourceKey("api", "scores", "v1", { ...filters, dataset: "dataset_b" }),
    ).not.toEqual(key);
  });
  it("separates origins, models and horizons while keeping unrelated global dates independent", () => {
    const key = resourceKey("api", "forecasts", "v1", filters);
    expect(
      resourceKey("api", "forecasts", "v1", { ...filters, horizon: 4 }),
    ).not.toEqual(key);
    expect(
      resourceKey("api", "forecasts", "v1", {
        ...filters,
        origin: "2007-05-05T01:00:00",
      }),
    ).not.toEqual(key);
    expect(
      resourceKey("api", "forecasts", "v1", {
        ...filters,
        to: "2007-05-06T00:00:00",
      }),
    ).toEqual(key);
  });
  it("keeps inventory and event identity stable during unrelated filter changes", () => {
    expect(resourceKey("api", "datasets", "v1", filters)).toEqual(
      resourceKey("api", "datasets", "v2", { ...filters, origin: "other" }),
    );
    expect(resourceKey("api", "event", "v1", filters, "e1")).toEqual(
      resourceKey("api", "event", "v2", { ...filters, run: "other" }, "e1"),
    );
  });
  it("separates demo and API results", () =>
    expect(resourceKey("demo", "series", "v1", filters)).not.toEqual(
      resourceKey("api", "series", "v1", filters),
    ));
});

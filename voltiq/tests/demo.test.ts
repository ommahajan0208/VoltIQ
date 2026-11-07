import { describe, it, expect } from "vitest";
import {
  demoFixture,
  demoRead,
  saveDemoReview,
  demoOrigins,
} from "../src/lib/demo";
import type {
  Bin,
  CandidateEvent,
  Filters,
  ForecastPoint,
  Overview,
  Score,
} from "../src/lib/types";
export const filters: Filters = {
  dataset: "demo_household",
  run: "demo_run",
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
  origin: demoOrigins[0],
  horizon: 16,
  model: "synthetic_forecast",
  forecast_mode: "backtest",
};
describe("explicit synthetic adapter integrity", () => {
  it("uses the same scoped observations for daily profiles and overview totals", async () => {
    const f = {
      ...filters,
      scope: "overnight",
      from: "2007-05-02T00:00:00",
      to: "2007-05-03T00:00:00",
    };
    const profile = (await demoRead(
      "profiles",
      f,
    )) as import("../src/lib/types").Profiles;
    const overview = (await demoRead("overview", f)) as Overview;
    expect(profile.daily).toHaveLength(1);
    expect(profile.daily[0].observed_energy_kwh).toBeCloseTo(
      overview.observed_energy_kwh!,
    );
    expect(profile.slots).toHaveLength(20);
    expect(profile.slots.every((s) => s.slot < "05:00")).toBe(true);
  });
  it("never labels the fixture as UCI data or actual model evaluation", async () => {
    const f = await demoFixture();
    expect(f.dataset.source_kind).toBe("synthetic");
    expect(f.run.evaluation_kind).toBe("synthetic_demonstration");
    expect(await demoRead("metrics", filters)).toEqual([]);
  });
  it("has unique intervals and keeps gaps null", async () => {
    const rows = (await demoRead("series", filters)) as Bin[];
    expect(new Set(rows.map((r) => r.bin_start)).size).toBe(672);
    const missing = rows.filter((r) => r.quality === "missing");
    expect(missing).toHaveLength(4);
    for (const r of missing) {
      expect(r.active_power_kw).toBeNull();
      expect(r.observed_energy_kwh).toBeNull();
    }
  });
  it("does not mark excluded observations normal", async () => {
    const rows = (await demoRead("scores", filters)) as Score[];
    for (const r of rows.filter((r) => r.status !== "scored")) {
      expect(r.score).toBeNull();
      expect(r.candidate).toBeNull();
    }
  });
  it("event durations consist only of adjacent flagged bins", async () => {
    const f = await demoFixture();
    for (const e of f.events) {
      const support = f.scores.filter(
        (s) => s.bin_start >= e.start && s.bin_start < e.end,
      );
      expect(support.length * 15).toBe(e.duration_minutes);
      expect(
        support.every((s) => s.candidate === true && s.status === "scored"),
      ).toBe(true);
    }
    expect(f.scores.filter((s) => s.candidate).length).toBe(
      f.events.reduce((total, e) => total + e.duration_minutes / 15, 0),
    );
  });
  it("returns the same primary event count in overview and the event list", async () => {
    const overview = (await demoRead("overview", filters)) as Overview;
    const events = (await demoRead("events", filters)) as CandidateEvent[];
    expect(overview.candidate_count).toBe(events.length);
  });
  it("labels clipped intersections while preserving whole-event facts", async () => {
    const events = (await demoRead("events", {
      ...filters,
      from: "2007-05-02T03:15:00",
      to: "2007-05-02T03:30:00",
    })) as CandidateEvent[];
    expect(events).toHaveLength(1);
    expect(events[0].duration_minutes).toBe(60);
    expect(events[0].visible_start).toBe("2007-05-02T03:15:00");
    expect(events[0].start).toBe("2007-05-02T03:00:00");
  });
  it("distinguishes missing-only energy and unscored coverage from zero consumption", async () => {
    const overview = (await demoRead("overview", {
      ...filters,
      from: "2007-05-03T04:30:00",
      to: "2007-05-03T05:30:00",
    })) as Overview;
    expect(overview.observed_energy_kwh).toBeNull();
    expect(overview.eligible_scored_bins).toBe(0);
    expect(overview.coverage).toBe(0);
  });
  it("supports review filters and revision conflicts without browser storage", async () => {
    const f = await demoFixture();
    const id = f.events[0].id;
    const saved = saveDemoReview(id, {
      status: "needs_followup",
      note: "A plain-text observation",
      revision: 0,
    });
    expect(saved.revision).toBe(1);
    expect(() => saveDemoReview(id, { ...saved, revision: 0 })).toThrow(
      /changed/,
    );
    const rows = (await demoRead("events", {
      ...filters,
      review: "needs_followup",
    })) as CandidateEvent[];
    expect(rows).toHaveLength(1);
    expect(rows[0].review.note).toBe("A plain-text observation");
  });
  it("future forecasts have dated targets and no invented observed ground truth", async () => {
    const rows = (await demoRead("forecasts", {
      ...filters,
      forecast_mode: "future",
    })) as ForecastPoint[];
    expect(rows).toHaveLength(16);
    expect(rows[0].target_start).toBe("2007-05-08T00:00:00");
    expect(rows.every((r) => r.actual_kw === null && !r.target_eligible)).toBe(
      true,
    );
  });
  it("returns only the requested forecast horizon and maintains ordered quantiles", async () => {
    const rows = (await demoRead("forecasts", {
      ...filters,
      horizon: 4,
    })) as ForecastPoint[];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.q10_kw! <= row.q50_kw! && row.q50_kw! <= row.q90_kw!).toBe(
        true,
      );
      expect(row.origin).toBe(filters.origin);
    }
  });
  it("does not invent forecasts for unsaved origins", async () =>
    await expect(
      demoRead("forecasts", { ...filters, origin: "2007-05-02T00:00:00" }),
    ).rejects.toThrow(/No saved/));
  it("never substitutes another detector’s scores", async () =>
    expect(
      await demoRead("scores", { ...filters, detector: "statistical" }),
    ).toEqual([]));
});

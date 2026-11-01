import type {
  Bin,
  CandidateEvent,
  Dataset,
  Run,
  Score,
  Filters,
  Overview,
  ForecastPoint,
  Profiles,
  QualityReport,
} from "./types";
import { inRange } from "./time";
type Fixture = {
  dataset: Dataset;
  run: Run;
  bins: Bin[];
  scores: Score[];
  events: CandidateEvent[];
  profiles: Profiles;
  quality: QualityReport;
  forecasts: Record<string, ForecastPoint[]>;
};
let loaded: Promise<Fixture> | undefined;
const reviews = new Map<string, CandidateEvent["review"]>();
export const demoFixture = () =>
  (loaded ??= import("@/fixtures/synthetic.json").then(
    (mod) => mod.default as Fixture,
  ));
export const demoOrigins = [
  "2007-05-03T01:00:00",
  "2007-05-05T01:00:00",
  "2007-05-07T01:00:00",
];
export async function demoRead(
  resource: string,
  f: Filters,
  id?: string,
): Promise<unknown> {
  const data = await demoFixture();
  const bins = data.bins.filter(
    (b) =>
      inRange(b.bin_start, f.from, f.to) &&
      (f.scope !== "overnight" || b.bin_start.slice(11, 13) < "05"),
  );
  const visibleScores = data.scores.filter((s) =>
    bins.some((b) => b.bin_start === s.bin_start),
  );
  const allEvents = data.events
    .map((e) => ({ ...e, review: reviews.get(e.id) ?? e.review }))
    .filter(
      (e) =>
        e.start < f.to &&
        e.end > f.from &&
        (f.scope !== "overnight" || e.start.slice(11, 13) < "05"),
    );
  switch (resource) {
    case "datasets":
      return [data.dataset];
    case "runs":
      return [data.run];
    case "dataset":
      return data.dataset;
    case "run":
      return data.run;
    case "series":
      return bins;
    case "scores":
      return f.detector === "chronos_residual" ? visibleScores : [];
    case "events": {
      let events = allEvents.filter(
        (e) =>
          (f.direction === "all" || e.direction === f.direction) &&
          (f.review === "all" || e.review.status === f.review) &&
          e.peak_score >= (Number(f.min_score) || 0),
      );
      events = events.sort((a, b) =>
        f.sort === "score"
          ? b.peak_score - a.peak_score
          : f.sort === "duration"
            ? b.duration_minutes - a.duration_minutes
            : b.start.localeCompare(a.start),
      );
      return f.detector === "chronos_residual"
        ? events.map((e) => ({
            ...e,
            visible_start: e.start > f.from ? e.start : f.from,
            visible_end: e.end < f.to ? e.end : f.to,
          }))
        : [];
    }
    case "event": {
      const event = data.events.find((e) => e.id === id);
      if (!event)
        throw new Error(
          "This event does not exist in the synthetic demonstration.",
        );
      return { ...event, review: reviews.get(event.id) ?? event.review };
    }
    case "overview": {
      const has = bins.some((b) => b.observed_energy_kwh != null);
      return {
        observed_energy_kwh: has
          ? bins.reduce((a, b) => a + (b.observed_energy_kwh ?? 0), 0)
          : null,
        overnight_observed_energy_kwh: has
          ? bins
              .filter((b) => b.bin_start.slice(11, 13) < "05")
              .reduce((a, b) => a + (b.observed_energy_kwh ?? 0), 0)
          : null,
        candidate_count: allEvents.length,
        eligible_scored_bins: visibleScores.filter((s) => s.status === "scored")
          .length,
        expected_bins: bins.length,
        coverage: bins.length
          ? bins.reduce((a, b) => a + b.valid_active_minutes, 0) /
            (bins.length * 15)
          : 0,
        estimated_above_reference_kwh: null,
      } satisfies Overview;
    }
    case "forecasts": {
      const points =
        data.forecasts[
          f.forecast_mode === "future" ? data.dataset.to : f.origin
        ];
      if (!points)
        throw new Error(
          "No saved synthetic forecast at this origin. Choose a listed origin.",
        );
      return points
        .slice(0, f.horizon)
        .map((p) => ({ ...p, horizon: f.horizon }));
    }
    // No fabricated scientific evaluation numbers: this fixture is only a visual demo.
    case "metrics":
      return [];
    case "quality":
      return data.quality;
    case "profiles": {
      // Emulate server filtering only for the explicit synthetic fixture.
      // Real profile calculations always come from the backend.
      const days = new Map<string, Bin[]>();
      const slots = new Map<string, Bin[]>();
      for (const bin of bins) {
        const day = bin.bin_start.slice(0, 10),
          slot = bin.bin_start.slice(11, 16);
        days.set(day, [...(days.get(day) ?? []), bin]);
        slots.set(slot, [...(slots.get(slot) ?? []), bin]);
      }
      return {
        daily: [...days].map(([date, rows]) => ({
          date,
          observed_energy_kwh: rows.some((r) => r.observed_energy_kwh != null)
            ? rows.reduce((total, r) => total + (r.observed_energy_kwh ?? 0), 0)
            : null,
          coverage:
            rows.reduce((total, r) => total + r.valid_active_minutes, 0) /
            (rows.length * 15),
          valid_bins: rows.filter((r) => r.quality === "complete").length,
        })),
        slots: [...slots]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([slot, rows]) => {
            const values = rows
              .flatMap((r) =>
                r.active_power_kw == null ? [] : [r.active_power_kw],
              )
              .sort((a, b) => a - b);
            return {
              slot,
              median_kw: values.length
                ? values[Math.floor(values.length / 2)]
                : null,
              count: values.length,
            };
          }),
        circuits: [],
      } satisfies Profiles;
    }
    case "jobs":
      return [];
    default:
      throw new Error("This action requires the local backend.");
  }
}
export function saveDemoReview(id: string, review: CandidateEvent["review"]) {
  const current = reviews.get(id);
  if (current && current.revision !== review.revision)
    throw new Error("The demonstration note changed. Reload before saving.");
  const saved = { ...review, revision: review.revision + 1 };
  reviews.set(id, saved);
  return saved;
}

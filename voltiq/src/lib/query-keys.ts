import type { Filters, Mode } from "./types";
// Each key contains its scientific identity and only the filters the resource consumes.
export function resourceKey(
  mode: Mode,
  resource: string,
  version: string,
  f: Filters,
  id?: string,
) {
  const root = [mode, resource];
  if (resource === "datasets" || resource === "jobs") return root;
  if (resource === "event" || resource === "job" || resource === "report")
    return [...root, id];
  if (resource === "runs" || resource === "dataset" || resource === "quality")
    return [...root, f.dataset, version];
  if (resource === "run") return [...root, f.dataset, version, id ?? f.run];
  if (resource === "forecasts")
    return [
      ...root,
      f.dataset,
      version,
      f.run,
      f.origin,
      f.horizon,
      f.model,
      f.forecast_mode,
    ];
  if (resource === "recommendations") return [...root, f.dataset, version, f.run, f.from, f.to, "rule-v1"];
  if (resource === "metrics")
    return [...root, f.dataset, version, f.run, f.horizon, f.model];
  const range = [f.dataset, version, f.from, f.to, f.scope];
  if (resource === "series") return [...root, ...range, f.channel];
  if (resource === "peaks") return [...root, ...range, "peak-analysis"];
  if (resource === "profiles") return [...root, ...range];
  if (resource === "overview") return [...root, ...range, f.run];
  if (resource === "scores") return [...root, ...range, f.run, f.detector];
  return [
    ...root,
    ...range,
    f.run,
    f.detector,
    f.direction,
    f.review,
    f.sort,
    f.min_score,
    f.cursor,
  ];
}

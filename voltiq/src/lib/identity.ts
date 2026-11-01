import type { Envelope, Filters } from "./types";

export function verifyIdentity(
  resource: string,
  f: Filters,
  result: Envelope<unknown>,
) {
  const datasetBound = [
    "series",
    "profiles",
    "quality",
    "overview",
    "scores",
    "events",
    "forecasts",
    "metrics",
    "peaks",
  ];
  const runBound = [
    "overview",
    "scores",
    "events",
    "forecasts",
    "metrics",
    "recommendations",
  ];
  if (datasetBound.includes(resource)) {
    if (
      result.meta.schema_version !== "2.0" ||
      result.meta.time_basis !== "source_local_naive"
    )
      throw new Error(
        "Unsupported analysis schema or source-time convention. The panel was not rendered.",
      );
    if (!f.dataset || result.meta.dataset_id !== f.dataset)
      throw new Error("Dataset identity mismatch. The panel was not rendered.");
  }
  if (runBound.includes(resource) && (!f.run || result.meta.run_id !== f.run))
    throw new Error("Run identity mismatch. The panel was not rendered.");
  if (
    result.meta.dataset_version &&
    f.version &&
    result.meta.dataset_version !== f.version
  )
    throw new Error("Dataset version mismatch. The panel was not rendered.");
}
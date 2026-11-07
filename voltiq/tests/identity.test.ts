import { describe, it, expect } from "vitest";
import { verifyIdentity } from "../src/lib/identity";
import type { Envelope, Filters } from "../src/lib/types";
const f = { dataset: "ds1", run: "run1", version: "v1" } as Filters;
const result: Envelope<unknown> = {
  data: [],
  meta: {
    schema_version: "2.0",
    time_basis: "source_local_naive",
    dataset_id: "ds1",
    run_id: "run1",
    dataset_version: "v1",
  },
};
describe("analysis response identity", () => {
  it("accepts matching scientific identity", () =>
    expect(() => verifyIdentity("scores", f, result)).not.toThrow());
  it("rejects another dataset or run before rendering", () => {
    expect(() =>
      verifyIdentity("scores", f, {
        ...result,
        meta: { ...result.meta, dataset_id: "ds2" },
      }),
    ).toThrow(/Dataset identity/);
    expect(() =>
      verifyIdentity("forecasts", f, {
        ...result,
        meta: { ...result.meta, run_id: "run2" },
      }),
    ).toThrow(/Run identity/);
  });
  it("rejects missing identity and incompatible source conventions", () => {
    expect(() =>
      verifyIdentity("overview", f, {
        ...result,
        meta: { ...result.meta, run_id: undefined },
      }),
    ).toThrow(/Run identity/);
    expect(() =>
      verifyIdentity("series", f, {
        ...result,
        meta: { ...result.meta, time_basis: "viewer_local" },
      }),
    ).toThrow(/source-time/);
  });
  it("rejects mismatched immutable versions", () =>
    expect(() =>
      verifyIdentity("series", f, {
        ...result,
        meta: { ...result.meta, dataset_version: "v2" },
      }),
    ).toThrow(/version mismatch/));
});

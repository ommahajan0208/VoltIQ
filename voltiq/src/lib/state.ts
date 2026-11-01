"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { readApi } from "./api/client";
import { demoRead } from "./demo";
import { isSourceTimestamp } from "./time";
import { resourceKey } from "./query-keys";
import { verifyIdentity } from "./identity";
import type { Dataset, Run, Filters, Mode, Envelope } from "./types";
export function useView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mode: Mode = params.get("mode") === "demo" ? "demo" : "api";
  const requestedOrigin = params.get("origin") ?? "";
  const filters: Filters = {
    version: params.get("version") ?? "",
    dataset: params.get("dataset") ?? "",
    run: params.get("run") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    scope: params.get("scope") ?? "all",
    channel: params.get("channel") ?? "active_power_kw",
    detector: params.get("detector") ?? "chronos_residual",
    direction: params.get("direction") ?? "all",
    review: params.get("review") ?? "all",
    sort: params.get("sort") ?? "newest",
    min_score: params.get("min_score") ?? "",
    cursor: params.get("cursor") ?? "",
    origin: isSourceTimestamp(requestedOrigin)
      ? requestedOrigin
      : "2007-05-03T01:00:00",
    horizon: [1, 4, 16].includes(Number(params.get("horizon")))
      ? Number(params.get("horizon"))
      : 16,
    model:
      params.get("model") ??
      (mode === "demo" ? "synthetic_forecast" : "chronos_bolt_tiny"),
    forecast_mode: params.get("forecast_mode") ?? "backtest",
  };
  function update(
    values: Record<string, string | number | null>,
    replace = false,
  ) {
    const next = new URLSearchParams(params.toString());
    Object.entries(values).forEach(([k, v]) => {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    });
    router[replace ? "replace" : "push"](`${pathname}?${next}`, {
      scroll: false,
    });
  }
  function href(path: string, values: Record<string, string | null> = {}) {
    const next = new URLSearchParams(params.toString());
    next.delete("cursor");
    Object.entries(values).forEach(([k, v]) =>
      v === null ? next.delete(k) : next.set(k, v),
    );
    return `${path}?${next}`;
  }
  return { mode, filters, update, href, pathname, params };
}
export function useResource<T>(
  resource: string,
  enabled = true,
  id?: string,
  override: Partial<Filters> = {},
) {
  const { mode, filters, params } = useView();
  const f = { ...filters, ...override };
  return useQuery<Envelope<T>, Error>({
    queryKey: resourceKey(mode, resource, f.version ?? "", f, id),
    enabled,
    refetchInterval: (query) => {
      if (mode === "demo") return false;
      if (resource === "jobs") return 10000;
      if (resource === "job") {
        const job = query.state.data?.data as { status: string } | undefined;
        return !job || ["queued", "running", "cancelling"].includes(job.status)
          ? 2000
          : false;
      }
      if (resource === "report") {
        const report = query.state.data?.data as { status: string } | undefined;
        return !report ||
          ["queued", "running", "pending", "processing"].includes(report.status)
          ? 2000
          : false;
      }
      return false;
    },
    queryFn: async ({ signal }) => {
      if (mode === "demo")
        return {
          data: (await demoRead(resource, f, id)) as T,
          meta: {
            schema_version: "2.0",
            dataset_id: f.dataset,
            run_id: f.run,
            time_basis: "source_local_naive",
          },
        } as Envelope<T>;
      const result = await readApi<T>(resource, f, signal, id);
      verifyIdentity(resource, f, result);
      return result;
    },
  });
}
export function useSelection() {
  const view = useView();
  const datasets = useResource<Dataset[]>("datasets");
  const dataset = datasets.data?.data.find(
    (d) => d.id === view.filters.dataset,
  );
  const runs = useResource<Run[]>("runs", dataset?.status === "ready");
  const run = runs.data?.data.find(
    (r) =>
      r.id === view.filters.run &&
      r.dataset_id === dataset?.id &&
      r.dataset_version === dataset?.version,
  );
  useEffect(() => {
    const current = view.params;
    const ds = datasets.data?.data;
    if (!current.get("dataset") && ds?.length) {
      view.update({ dataset: ds[0].id, version: ds[0].version }, true);
      return;
    }
    if (
      dataset?.status === "ready" &&
      !current.get("run") &&
      runs.data?.data.length
    ) {
      const available = runs.data.data.filter(
        (r) =>
          r.status === "succeeded" && r.dataset_version === dataset.version,
      );
      const found =
        available.find((r) => r.evaluation_kind === "held_out") ?? available[0];
      if (found) {
        view.update({ run: found.id, model: found.model_id }, true);
        return;
      }
    }
    if (run && view.mode === "api" && !current.get("model")) {
      view.update({ model: run.model_id }, true);
      return;
    }
    if (
      dataset?.status === "ready" &&
      isSourceTimestamp(current.get("from") ?? "") &&
      isSourceTimestamp(current.get("to") ?? "") &&
      (current.get("from")! < dataset.from || current.get("to")! > dataset.to)
    ) {
      const scored = !["/consumption", "/data"].includes(view.pathname);
      const requestedFrom = current.get("from")!;
      const requestedTo = current.get("to")!;
      const from = requestedFrom < dataset.from ? dataset.from : requestedFrom;
      const to = requestedTo > dataset.to ? dataset.to : requestedTo;
      view.update(
        {
          from: from < to ? from : dataset.from,
          to: from < to ? to : dataset.to,
          version: dataset.version,
          ...(scored && run && view.mode === "api" && !current.get("origin")
            ? { origin: run.test_from }
            : {}),
        },
        true,
      );
      return;
    }
    if (
      dataset?.status === "ready" &&
      (!isSourceTimestamp(current.get("from") ?? "") ||
        !isSourceTimestamp(current.get("to") ?? ""))
    ) {
      const scored = !["/consumption", "/data"].includes(view.pathname);
      if (scored && runs.isPending) return;
      view.update(
        {
          from: scored && run ? run.test_from : dataset.from,
          to: scored && run ? run.test_to : dataset.to,
          scope: view.filters.scope,
          version: dataset.version,
          ...(scored && run && view.mode === "api" && !current.get("origin")
            ? { origin: run.test_from }
            : {}),
        },
        true,
      );
      return;
    }
    if (
      dataset?.status === "ready" &&
      view.filters.from &&
      view.filters.to &&
      ["/forecasting", "/anomalies"].includes(view.pathname)
    ) {
      const defaults: Record<string, string | number> = {
        detector: view.filters.detector,
        horizon: view.filters.horizon,
        model: view.filters.model,
        origin:
          view.mode === "api" && run ? run.test_from : view.filters.origin,
        forecast_mode: view.filters.forecast_mode,
      };
      const missing = Object.fromEntries(
        Object.entries(defaults).filter(([key]) => !current.has(key)),
      );
      if (Object.keys(missing).length) view.update(missing, true);
    }
  }, [
    datasets.data,
    runs.data,
    dataset,
    run,
    view.params.toString(),
    view.pathname,
  ]); // URL is the durable view state.
  return {
    ...view,
    datasets,
    runs,
    dataset,
    run,
    ready:
      dataset?.status === "ready" &&
      isSourceTimestamp(view.filters.from) &&
      isSourceTimestamp(view.filters.to) &&
      view.filters.from < view.filters.to &&
      view.filters.from >= dataset.from &&
      view.filters.to <= dataset.to,
  };
}

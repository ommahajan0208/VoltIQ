"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import { addSourceMinutes, number, sourceLabel } from "@/lib/time";
import { demoOrigins } from "@/lib/demo";
import { mutateApi } from "@/lib/api/client";
import type { Bin, ForecastPoint, Job, Metrics } from "@/lib/types";
import { AnalysisGate } from "@/components/analysis-gate";
import {
  PageTitle,
  Panel,
  QueryState,
  Metric,
  Notice,
  Badge,
} from "@/components/ui";
import { ForecastChart } from "@/components/charts";
import { ExportButton } from "@/components/jobs";
export function ForecastingPage() {
  const { ready, dataset, run, mode, filters, update, params } = useSelection();
  const future = filters.forecast_mode === "future";
  const origin = future ? (dataset?.to ?? filters.origin) : filters.origin;
  const context = useResource<Bin[]>("series", ready, undefined, {
    from: addSourceMinutes(origin, -192 * 15),
    to: origin,
    scope: "all",
  });
  const forecasts = useResource<ForecastPoint[]>(
    "forecasts",
    ready && !!run,
    undefined,
    { origin },
  );
  const jobId = params.get("job") ?? "";
  const job = useResource<Job>("job", !!jobId && mode === "api", jobId);
  const metrics = useResource<Metrics[]>("metrics", ready && !!run && !future);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const baselines = params.get("baselines") === "1";
  const points = forecasts.data?.data ?? [];
  const shown = points.filter((p) => p.origin === origin);
  const mismatch = points.some((p) => p.origin !== origin);
  const matchedMetric = metrics.data?.data.find(
    (m) => m.horizon === filters.horizon && m.model_id === filters.model,
  );
  useEffect(() => {
    if (run?.evaluation_kind === "inference" && !future)
      update({ forecast_mode: "future", origin: dataset?.to ?? null }, true);
  }, [run?.evaluation_kind, future, dataset?.to]);
  useEffect(() => {
    if (job?.data?.data.status === "succeeded") forecasts.refetch();
  }, [job?.data?.data.status, forecasts.refetch]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      let runId = run?.id;
      if (!runId) {
        const created = await mutateApi<{ run_id: string; job_id: string }>(
          "/runs",
          {
            dataset_id: dataset?.id,
            dataset_version: dataset?.version,
            model_id: filters.model,
            evaluation_kind: "inference",
            config: { context_bins: 192 },
          },
          "POST",
          crypto.randomUUID(),
        );
        update({ run: created.run_id, job: created.job_id });
        return;
      }
      const job = await mutateApi<{ job_id: string }>(
        `/runs/${runId}/forecasts`,
        {
          origin_mode: future ? "dataset_endpoint" : "historical",
          origin,
          horizon: filters.horizon,
          model_id: filters.model,
        },
        "POST",
        crypto.randomUUID(),
      );
      update({ job: job.job_id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ANALYSIS / FORECASTING"
        title="What comes next?"
        description="Origin-specific estimates with an explicit boundary between known history and future targets."
        action={
          <ExportButton
            kind="forecasts"
            disabled={!shown.length || mismatch}
            rows={shown as unknown as Record<string, unknown>[]}
          />
        }
      />
      <AnalysisGate requireRun={false}>
        <div className="forecast-toolbar">
          <div className="segmented" role="group" aria-label="Forecast mode">
            <button
              className={!future ? "selected" : ""}
              onClick={() =>
                update({
                  forecast_mode: "backtest",
                  origin:
                    mode === "demo" ? demoOrigins[0] : (run?.test_from ?? null),
                })
              }
            >
              Historical backtest
            </button>
            <button
              className={future ? "selected" : ""}
              onClick={() =>
                update({ forecast_mode: "future", origin: dataset?.to ?? null })
              }
            >
              After dataset endpoint
            </button>
          </div>
          <label className="field inline">
            Horizon
            <select
              value={filters.horizon}
              onChange={(e) => update({ horizon: Number(e.target.value) })}
            >
              <option value={1}>15 minutes</option>
              <option value={4}>1 hour</option>
              <option value={16}>4 hours</option>
            </select>
          </label>
          <label className="field inline">
            Engine
            <select
              value={filters.model}
              onChange={(e) => update({ model: e.target.value })}
            >
              {mode === "demo" ? (
                <option value="synthetic_forecast">
                  Synthetic illustration
                </option>
              ) : (
                <>
                  <option value="chronos_bolt_tiny">Chronos-Bolt Tiny</option>
                  <option value="persistence">Persistence baseline</option>
                  <option value="seasonal_naive">
                    Seasonal naive baseline
                  </option>
                </>
              )}
            </select>
          </label>
        </div>
        <Panel
          title={
            future
              ? "A forecast beyond your last reading"
              : "A causal view of a historical forecast"
          }
          subtitle={
            future
              ? "Future targets have no observed ground truth. Accuracy is unavailable."
              : "Only observations before the displayed origin enter model context."
          }
          action={
            <Badge tone={mode === "demo" ? "amber" : "cyan"}>
              {mode === "demo" ? "Synthetic forecast" : filters.model}
            </Badge>
          }
        >
          <div className="origin-toolbar">
            <div>
              <span className="muted">Forecast origin · source time</span>
              <strong>{sourceLabel(origin)}</strong>
            </div>
            {!future && (
              <div className="inline-controls">
                <button
                  className="icon-button"
                  aria-label="Previous origin"
                  disabled={mode === "demo" && demoOrigins.indexOf(origin) <= 0}
                  onClick={() =>
                    update({
                      origin:
                        mode === "demo"
                          ? demoOrigins[
                              Math.max(0, demoOrigins.indexOf(origin) - 1)
                            ]
                          : addSourceMinutes(origin, -15),
                    })
                  }
                >
                  <ChevronLeft size={18} />
                </button>
                {mode === "demo" ? (
                  <select
                    aria-label="Saved synthetic origin"
                    value={origin}
                    onChange={(e) => update({ origin: e.target.value })}
                  >
                    {demoOrigins.map((o) => (
                      <option key={o} value={o}>
                        {sourceLabel(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="Historical forecast origin in source time"
                    type="datetime-local"
                    step={900}
                    value={origin.slice(0, 16)}
                    onChange={(e) => update({ origin: e.target.value + ":00" })}
                  />
                )}
                <button
                  className="icon-button"
                  aria-label="Next origin"
                  disabled={
                    mode === "demo" &&
                    demoOrigins.indexOf(origin) >= demoOrigins.length - 1
                  }
                  onClick={() =>
                    update({
                      origin:
                        mode === "demo"
                          ? demoOrigins[
                              Math.min(
                                demoOrigins.length - 1,
                                demoOrigins.indexOf(origin) + 1,
                              )
                            ]
                          : addSourceMinutes(origin, 15),
                    })
                  }
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={baselines}
                onChange={(e) =>
                  update({ baselines: e.target.checked ? "1" : null })
                }
              />
              Show baselines
            </label>
          </div>
          {!run ? (
            <Notice>
              Ready observations can support an inference run. Generate one when
              a cached checkpoint and 192 eligible context bins are available.
            </Notice>
          ) : (
            <QueryState query={forecasts}>
              {mismatch ? (
                <Notice>
                  The forecast returned a different origin. Its values have not
                  been displayed.
                </Notice>
              ) : (
                <QueryState query={context}>
                  {future && !shown.length ? (
                    <Notice>
                      No forecast points are available for this endpoint yet.
                      Click "Generate missing inference" below to create and
                      load the forecast chart.
                    </Notice>
                  ) : (
                    <ForecastChart
                      context={(context.data?.data ?? [])
                        .filter((b) => b.bin_start < origin)
                        .slice(-48)}
                      points={shown}
                      origin={origin}
                      baselines={baselines}
                    />
                  )}
                </QueryState>
              )}
            </QueryState>
          )}
          {mode === "api" && (
            <div className="panel-actions">
              <button
                className="button primary"
                disabled={busy || !dataset?.capabilities.forecast}
                title={
                  !dataset?.capabilities.forecast
                    ? "Requires a cached checkpoint and 192 eligible context bins"
                    : undefined
                }
                onClick={generate}
              >
                <Play size={15} />
                {busy
                  ? "Submitting…"
                  : run
                    ? "Generate missing inference"
                    : "Create inference run"}
              </button>
            </div>
          )}
          {!dataset?.capabilities.forecast && (
            <Notice>
              Forecasting requires at least 192 eligible 15-minute context bins
              and a ready cached checkpoint. Add history or prepare the local
              model cache.
            </Notice>
          )}
          {error && <Notice>{error}</Notice>}
          <p className="small muted">
            The q10–q90 band is a forecast range. It is not a guaranteed
            confidence interval.
          </p>
        </Panel>
        {!future && (
          <>
            <div className="metrics-grid">
              <Metric
                label="Held-out MAE"
                value={matchedMetric?.mae_kw}
                unit="kW"
                detail={`${matchedMetric?.count ?? 0} evaluated targets · selected model / horizon`}
              />
              <Metric
                label="Held-out RMSE"
                value={matchedMetric?.rmse_kw}
                unit="kW"
                detail="Overall held-out summary; not origin-specific accuracy"
              />
              <Metric
                label="MASE"
                value={matchedMetric?.mase}
                detail="Scaled to the recorded training baseline"
              />
              <Metric
                label="Measured band coverage"
                value={
                  matchedMetric?.coverage_q10_q90 != null
                    ? matchedMetric.coverage_q10_q90 * 100
                    : null
                }
                unit="%"
                detail="Empirical held-out q10–q90 coverage"
              />
            </div>
            {mode === "demo" && (
              <Notice>
                Scientific metrics are unavailable for this illustrative
                fixture. No Chronos model was run.
              </Notice>
            )}
          </>
        )}
        <div className="two-columns">
          <Panel
            title="Dated forecast values"
            subtitle={`${shown.length} target intervals · ${filters.horizon * 15} minute horizon`}
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Target · source time</th>
                    <th>q10 kW</th>
                    <th>Median kW</th>
                    <th>q90 kW</th>
                    <th>Observed kW</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.target_start}>
                      <td>{sourceLabel(p.target_start)}</td>
                      <td>{number(p.q10_kw)}</td>
                      <td>{number(p.q50_kw)}</td>
                      <td>{number(p.q90_kw)}</td>
                      <td>
                        {future
                          ? "Unavailable"
                          : number(p.target_eligible ? p.actual_kw : null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title="Context & provenance"
            subtitle="An estimate is only as traceable as its inputs."
          >
            <dl className="facts">
              <div>
                <dt>Model</dt>
                <dd>
                  {mode === "demo" ? "Illustrative formula" : filters.model}
                </dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{run?.model_revision ?? "Not registered"}</dd>
              </div>
              <div>
                <dt>Context requirement</dt>
                <dd>192 eligible bins / 48 hours</dd>
              </div>
              <div>
                <dt>Known observations shown</dt>
                <dd>Last 48 display bins before origin</dd>
              </div>
              <div>
                <dt>Target mode</dt>
                <dd>
                  {future
                    ? "Unknown future targets"
                    : "Saved historical targets"}
                </dd>
              </div>
              <div>
                <dt>Time convention</dt>
                <dd>Offset-free source household time</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </AnalysisGate>
    </>
  );
}

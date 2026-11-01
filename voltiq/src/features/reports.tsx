"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Printer, FileText } from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import { mutateApi } from "@/lib/api/client";
import { number, sourceLabel } from "@/lib/time";
import type {
  Overview,
  Bin,
  CandidateEvent,
  Report,
  ForecastPoint,
  QualityReport,
  Job,
} from "@/lib/types";
import { AnalysisGate } from "@/components/analysis-gate";
import { PageTitle, Panel, QueryState, Notice, Badge } from "@/components/ui";
import { TimeSeries, ForecastChart } from "@/components/charts";
import { ExportButton } from "@/components/jobs";
const sectionOptions = [
  ["consumption", "Consumption & coverage"],
  ["forecasting", "Forecasting"],
  ["events", "Candidate events"],
  ["notes", "Review notes (opt-in)"],
  ["quality", "Data quality"],
  ["methodology", "Methodology & limitations"],
] as const;
export function ReportsPage() {
  const { ready, run, dataset, mode, filters, params, update, href } = useSelection();
  const enabled = ready && !!run;
  const selected = (
    params.get("sections") ?? "consumption,events,quality,methodology"
  ).split(",");
  const eventsFilter = (params.get("events") ?? "").split(",").filter(Boolean);
  const overview = useResource<Overview>("overview", enabled);
  const bins = useResource<Bin[]>("series", enabled);
  const events = useResource<CandidateEvent[]>("events", enabled, undefined, {
    direction: "all",
    review: "all",
    min_score: "",
    cursor: "",
  });
  const predictions = useResource<ForecastPoint[]>(
    "forecasts",
    enabled && selected.includes("forecasting"),
  );
  const quality = useResource<QualityReport>(
    "quality",
    enabled && selected.includes("quality"),
  );
  const reportId = params.get("report") ?? "";
  const saved = useResource<Report>(
    "report",
    !!reportId && mode === "api",
    reportId,
  );
  const jobs = useResource<Job[]>("jobs", mode === "api");
  const reportJobs = (jobs.data?.data ?? [])
    .filter((job) => job.kind === "report" && job.report_id && job.run_id === run?.id)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list =
    events.data?.data.filter(
      (e) => !eventsFilter.length || eventsFilter.includes(e.id),
    ) ?? [];
  const kpi = overview.data?.data;
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await mutateApi<{ report_id: string; job_id: string }>(
        "/reports",
        {
          run_id: run?.id,
          from: filters.from,
          to: filters.to,
          scope: filters.scope,
          sections: selected,
          event_ids: eventsFilter,
          forecast_origin: filters.origin,
          forecast_horizon: filters.horizon,
          forecast_model: filters.model,
          detector: filters.detector,
          format: "pdf",
        },
        "POST",
        crypto.randomUUID(),
      );
      update({ report: result.report_id, job: result.job_id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / REPORTS"
        title="Evidence you can share."
        description="A readable report with source dates, units, coverage and the limits of each conclusion."
      />
      <AnalysisGate>
        <div className="reports-layout">
          <Panel
            title="Report configuration"
            subtitle="This preview is a draft. Generation freezes its filters and review snapshot."
            className="report-controls"
          >
            <div className="report-sections">
              {sectionOptions.map(([key, label]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    onChange={(e) =>
                      update({
                        sections: (e.target.checked
                          ? [...selected, key]
                          : selected.filter((s) => s !== key)
                        ).join(","),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <dl className="facts">
              <div>
                <dt>Dataset</dt>
                <dd>{dataset?.label}</dd>
              </div>
              <div>
                <dt>Run</dt>
                <dd>
                  <code>{run?.id}</code>
                </dd>
              </div>
              <div>
                <dt>Source dates</dt>
                <dd>
                  {sourceLabel(filters.from)} → {sourceLabel(filters.to)}{" "}
                  (exclusive)
                </dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{filters.scope}</dd>
              </div>
              <div>
                <dt>Selected event IDs</dt>
                <dd>
                  {eventsFilter.length
                    ? eventsFilter.join(", ")
                    : "All matching events"}
                </dd>
              </div>
            </dl>
            {mode === "demo" ? (
              <button className="button primary" onClick={() => window.print()}>
                <Printer size={16} />
                Print synthetic preview
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  busy ||
                  !selected.length ||
                  overview.isPending ||
                  overview.isError
                }
                onClick={generate}
              >
                <FileText size={16} />
                {busy ? "Submitting…" : "Generate frozen PDF"}
              </button>
            )}
            <ExportButton
              kind="observations"
              rows={bins.data?.data as unknown as Record<string, unknown>[]}
              disabled={!bins.data?.data.length}
              label="Export observations CSV"
            />
            <ExportButton
              kind="events"
              rows={list.map((e) => ({
                event_id: e.id,
                start_source_time: e.start,
                end_source_time: e.end,
                duration_minutes: e.duration_minutes,
                score_kw: e.peak_score,
                review_status: e.review.status,
                ...(selected.includes("notes")
                  ? { review_note: e.review.note }
                  : {}),
              }))}
              disabled={!list.length}
              label="Export candidate events CSV"
            />
            {mode === "demo" && (
              <Notice>
                Print and CSV output remain labelled synthetic.
                Backend-generated PDF artifacts require API mode.
              </Notice>
            )}
            {error && <Notice>{error}</Notice>}
          </Panel>
          <article className="report-preview">
            <div className="report-topline">
              <span>VOLTIQ</span>
              <span>
                {mode === "demo" ? "SYNTHETIC DEMONSTRATION" : "REPORT DRAFT"}
              </span>
            </div>
            <h2>
              Household energy
              <br />
              analysis report
            </h2>
            <p className="report-subtitle">
              {dataset?.label} · source household time
            </p>
            <div className="report-identity">
              <p>
                <strong>Run:</strong> {run?.id}
              </p>
              <p>
                <strong>Range:</strong> {filters.from} → {filters.to}{" "}
                (exclusive)
              </p>
              <p>
                <strong>Method:</strong> {run?.model_id} ·{" "}
                {run?.evaluation_kind}
              </p>
            </div>
            {selected.includes("consumption") && (
              <section>
                <h3>01 / Consumption & coverage</h3>
                <QueryState query={overview}>
                  <div className="report-kpis">
                    <div>
                      <strong>{number(kpi?.observed_energy_kwh)} kWh</strong>
                      <span>Observed energy</span>
                    </div>
                    <div>
                      <strong>{number((kpi?.coverage ?? 0) * 100)}%</strong>
                      <span>Observed minute coverage</span>
                    </div>
                    <div>
                      <strong>
                        {kpi?.eligible_scored_bins ?? "Unavailable"}
                      </strong>
                      <span>Eligible scored intervals</span>
                    </div>
                  </div>
                </QueryState>
                <QueryState query={bins}>
                  {bins.data && <TimeSeries bins={bins.data.data} />}
                </QueryState>
              </section>
            )}
            {selected.includes("forecasting") && (
              <section>
                <h3>Forecasting</h3>
                <p>
                  Engine: {filters.model} · origin:{" "}
                  {sourceLabel(filters.origin)} · horizon:{" "}
                  {filters.horizon * 15} min. The shaded range is q10–q90, not a
                  guarantee.
                </p>
                <QueryState query={predictions}>
                  {predictions.data && (
                    <ForecastChart
                      context={(bins.data?.data ?? [])
                        .filter((b) => b.bin_start < filters.origin)
                        .slice(-48)}
                      points={predictions.data.data.filter(
                        (p) => p.origin === filters.origin,
                      )}
                      origin={filters.origin}
                      baselines={false}
                    />
                  )}
                </QueryState>
              </section>
            )}
            {selected.includes("events") && (
              <section>
                <h3>02 / Candidate intervals</h3>
                <QueryState query={events}>
                  <p>
                    {list.length} events loaded in the current response. Full
                    matching events are resolved by the report worker.
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Source start</th>
                          <th>Duration</th>
                          <th>Direction</th>
                          <th>Peak score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((e) => (
                          <tr key={e.id}>
                            <td>{sourceLabel(e.start)}</td>
                            <td>{e.duration_minutes} min</td>
                            <td>{e.direction}</td>
                            <td>
                              {number(e.peak_score)} {e.score_unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </QueryState>
              </section>
            )}
            {selected.includes("notes") && (
              <section>
                <h3>Human review notes</h3>
                {list.map((e) => (
                  <div key={e.id}>
                    <strong>
                      {sourceLabel(e.start)} ·{" "}
                      {e.review.status.replaceAll("_", " ")}
                    </strong>
                    <p className="plain-text">
                      {e.review.note || "No review note recorded."}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {selected.includes("quality") && (
              <section>
                <h3>03 / Data quality</h3>
                <QueryState query={quality}>
                  {quality.data && (
                    <p>
                      {quality.data.data.complete_bins == null ||
                      quality.data.data.partial_bins == null ||
                      quality.data.data.missing_bins == null
                        ? "Interval quality counts are unavailable for this registered dataset."
                        : `Full-dataset quality snapshot: ${quality.data.data.complete_bins} complete, ${quality.data.data.partial_bins} partial and ${quality.data.data.missing_bins} missing intervals.`}
                    </p>
                  )}
                </QueryState>
                <p>
                  Observed totals use valid readings only. Missing and partial
                  intervals retain explicit quality states. Forecast and
                  candidate eligibility require complete targets; no imputed
                  target becomes an observed result.
                </p>
              </section>
            )}
            {selected.includes("methodology") && (
              <section>
                <h3>04 / Methodology & limitations</h3>
                <p>
                  {dataset?.source_kind === "test"
                    ? "This local test fixture uses prebuilt intervals; it does not demonstrate PySpark ingestion. "
                    : mode === "demo"
                      ? "This synthetic illustration does not demonstrate PySpark ingestion. "
                      : "Minute readings are validated and aggregated by PySpark. "}
                  Chronological evaluation separates learned references,
                  validation calibration and held-out targets. Candidates group
                  adjacent flagged intervals under a saved threshold.
                </p>
                <p>
                  The household dataset has no verified anomaly labels. Unusual
                  readings may reflect ordinary activity or forecast error.
                  Estimated energy above a historical reference is not measured
                  waste or savings. Results from a short or incomplete sample
                  may not generalize.
                </p>
              </section>
            )}
            <footer>
              {mode === "demo"
                ? "Source: synthetic illustrative data, not UCI observations."
                : dataset?.source_kind === "test"
                  ? "Source: local test fixture, not measured UCI observations."
                  : dataset?.source_kind === "uci"
                    ? "Source attribution: UCI Individual Household Electric Power Consumption · CC BY 4.0."
                    : "Source: user-registered local dataset."}
              <br />
              Time basis: source_local_naive · offset-free source dates.
            </footer>
          </article>
        </div>
        {reportId && mode === "api" && (
          <Panel
            title="Generated report"
            subtitle="Downloads use the saved artifact’s identity, independent of the current draft."
          >
            <QueryState query={saved}>
              {saved.data && (
                <div className="saved-report">
                  <Badge
                    tone={
                      saved.data.data.status === "succeeded"
                        ? "success"
                        : "neutral"
                    }
                  >
                    {saved.data.data.status}
                  </Badge>
                  <div>
                    <strong>{saved.data.data.run_id}</strong>
                    <p>
                      {saved.data.data.from} → {saved.data.data.to}
                    </p>
                  </div>
                  {saved.data.data.status === "succeeded" &&
                    saved.data.data.artifact_ids.map((id) => (
                      <div className="frozen-report" key={id}>
                        <a
                          className="button"
                          href={`/api/v1/artifacts/${encodeURIComponent(id)}/download`}
                        >
                          <Download size={16} />
                          Download saved report
                        </a>
                        <iframe
                          title="Frozen report PDF preview"
                          src={`/api/v1/artifacts/${encodeURIComponent(id)}/preview`}
                        />
                      </div>
                    ))}
                </div>
              )}
            </QueryState>
          </Panel>
        )}
        {mode === "api" && (
          <Panel
            title="Recent saved reports"
            subtitle="Reports associated with this run in the latest 50 local jobs. Select one to inspect its frozen artifact."
          >
            <QueryState query={jobs}>
              {reportJobs.length ? (
                <div className="saved-runs">
                  {reportJobs.map((job) => (
                    <Link
                      className={`run-row ${reportId === job.report_id ? "selected" : ""}`}
                      href={href("/reports", { report: job.report_id ?? null })}
                      key={job.id}
                    >
                      <div>
                        <strong>{job.report_id}</strong>
                        <span>{job.created_at ?? "Date unavailable"}</span>
                      </div>
                      <Badge tone={job.status === "succeeded" ? "success" : "neutral"}>
                        {job.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="muted">No reports for this run appear in recent local jobs.</p>
              )}
            </QueryState>
          </Panel>
        )}
      </AnalysisGate>
    </>
  );
}

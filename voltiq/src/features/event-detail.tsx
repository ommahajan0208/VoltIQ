"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Copy } from "lucide-react";
import { useResource, useView } from "@/lib/state";
import { ApiError, mutateApi } from "@/lib/api/client";
import { saveDemoReview } from "@/lib/demo";
import { addSourceMinutes, number, sourceLabel } from "@/lib/time";
import type {
  CandidateEvent,
  Bin,
  Score,
  Review,
  ReviewStatus,
  Run,
} from "@/lib/types";
import {
  Panel,
  PageTitle,
  QueryState,
  Metric,
  Badge,
  Notice,
  Empty,
} from "@/components/ui";
import { TimeSeries, ScoreChart } from "@/components/charts";
export function EventDetailPage({ id }: { id: string }) {
  const { mode, filters, params, href, update } = useView();
  const eventQuery = useResource<CandidateEvent>("event", true, id);
  const event = eventQuery.data?.data;
  const before = [30, 60, 180].includes(Number(params.get("before")))
    ? Number(params.get("before"))
    : 60;
  const after = [30, 60, 180].includes(Number(params.get("after")))
    ? Number(params.get("after"))
    : 60;
  const run = useResource<Run>("run", !!event, event?.run_id, {
    dataset: event?.dataset_id ?? "",
    run: event?.run_id ?? "",
    version: "",
  });
  const evidenceFilters = {
    version: run.data?.data.dataset_version ?? "",
    dataset: event?.dataset_id ?? "",
    run: event?.run_id ?? "",
    from: event ? addSourceMinutes(event.start, -before) : filters.from,
    to: event ? addSourceMinutes(event.end, after) : filters.to,
    scope: "all",
    detector: event?.detector ?? "chronos_residual",
    channel: "active_power_kw",
  };
  const bins = useResource<Bin[]>(
    "series",
    !!event &&
      !!run.data &&
      ["chronos_residual", "statistical"].includes(event.detector),
    undefined,
    evidenceFilters,
  );
  const scores = useResource<Score[]>(
    "scores",
    !!event &&
      !!run.data &&
      ["chronos_residual", "statistical"].includes(event.detector),
    undefined,
    evidenceFilters,
  );
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ReviewStatus>("unreviewed");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [conflict, setConflict] = useState<Review | null>(null);
  const cache = useQueryClient();
  useEffect(() => {
    if (event && !dirty) {
      setNote(event.review.note);
      setStatus(event.review.status);
      setRevision(event.review.revision);
    }
  }, [event, dirty]);
  useEffect(() => {
    if (
      event &&
      (filters.dataset !== event.dataset_id ||
        filters.run !== event.run_id ||
        (!!run.data && filters.version !== run.data.data.dataset_version))
    )
      update(
        {
          dataset: event.dataset_id,
          run: event.run_id,
          version: run.data?.data.dataset_version ?? null,
          from: event.start,
          to: event.end,
        },
        true,
      );
  }, [event, run.data, filters.dataset, filters.run, filters.version]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (!event) return;
    if (Array.from(note).length > 2000) {
      setFeedback("Keep the note within 2,000 characters.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      const body = { status, note, expected_revision: revision };
      const saved =
        mode === "demo"
          ? saveDemoReview(id, { status, note, revision })
          : await mutateApi<Review>(`/events/${id}/review`, body, "PATCH");
      setRevision(saved.revision);
      setDirty(false);
      setConflict(null);
      await cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === mode &&
          ["event", "events"].includes(String(q.queryKey[1])),
      });
      setFeedback(
        mode === "demo"
          ? "Demonstration review saved for this session. Refresh resets it."
          : "Review saved.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const details = error.details as
          { current_review?: Review } | undefined;
        setConflict(details?.current_review ?? null);
        setFeedback(
          "A newer review exists. Your draft is preserved. Copy it, then reload the latest revision.",
        );
      } else setFeedback((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="breadcrumb" href={href("/anomalies")}>
        <ArrowLeft size={14} />
        Candidate events
      </Link>
      <QueryState query={eventQuery}>
        {event &&
        !["chronos_residual", "statistical"].includes(event.detector) ? (
          <Empty
            title="Window-support evidence requires the optional experiment view"
            href={href("/models")}
            action="Open experiment configuration"
          >
            This detector does not produce primary 15-minute forecast-residual
            events. Its reconstruction windows cannot be displayed as interval
            evidence.
          </Empty>
        ) : (
          event && (
            <>
              <PageTitle
                eyebrow="EVENT EVIDENCE"
                title={
                  event.detector === "chronos_residual"
                    ? `Consumption was ${event.direction === "mixed" ? "different from" : event.direction + " than"} the one-step forecast.`
                    : "Consumption differed from the saved statistical reference."
                }
                description={`${sourceLabel(event.start)} → ${sourceLabel(event.end)} · source household time`}
                action={<Badge tone="amber">Candidate · requires review</Badge>}
              />
              <div className="metrics-grid">
                <Metric
                  label="Whole-event duration"
                  value={event.duration_minutes}
                  unit="min"
                  detail="Strictly adjacent flagged 15-minute bins"
                />
                <Metric
                  label={
                    event.detector === "chronos_residual"
                      ? "Peak absolute residual"
                      : "Peak detector score"
                  }
                  value={event.peak_score}
                  unit={event.score_unit}
                  detail={
                    event.detector === "chronos_residual"
                      ? "One-step forecast deviation"
                      : "Saved statistical deviation score"
                  }
                />
                <Metric
                  label="Above historical reference"
                  value={event.estimated_above_reference_kwh}
                  unit="kWh"
                  detail="Estimated comparison · not measured savings"
                />
                <Metric
                  label="Flagged intervals"
                  value={event.duration_minutes / 15}
                  unit="bins"
                  detail="Whole event, including clipped filter portions"
                />
              </div>
              <Panel
                title="Observed and expected consumption"
                subtitle="Surrounding evidence retains missing observations and excluded intervals."
                action={
                  <div className="inline-controls">
                    <label className="field inline">
                      Context before
                      <select
                        value={before}
                        onChange={(e) =>
                          update({ before: Number(e.target.value) })
                        }
                      >
                        <option value={30}>30 min</option>
                        <option value={60}>1 hour</option>
                        <option value={180}>3 hours</option>
                      </select>
                    </label>
                    <label className="field inline">
                      After
                      <select
                        value={after}
                        onChange={(e) =>
                          update({ after: Number(e.target.value) })
                        }
                      >
                        <option value={30}>30 min</option>
                        <option value={60}>1 hour</option>
                        <option value={180}>3 hours</option>
                      </select>
                    </label>
                  </div>
                }
              >
                <QueryState query={run}>
                  <QueryState query={bins}>
                    <QueryState query={scores}>
                      {bins.data && (
                        <TimeSeries
                          bins={bins.data.data}
                          scores={scores.data?.data}
                          events={[event]}
                          syncGroup={id}
                        />
                      )}
                    </QueryState>
                  </QueryState>
                </QueryState>
              </Panel>
              <Panel
                title="Residual evidence"
                subtitle="Saved validation threshold; excluded intervals have no score."
              >
                <QueryState query={run}>
                  <QueryState query={scores}>
                    {scores.data && (
                      <ScoreChart scores={scores.data.data} syncGroup={id} />
                    )}
                  </QueryState>
                </QueryState>
              </Panel>
              <div className="two-columns">
                <Panel
                  title="Human review"
                  subtitle="Notes add context. Review status is not an anomaly ground-truth label."
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      save();
                    }}
                  >
                    <label className="field">
                      Review status
                      <select
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value as ReviewStatus);
                          setDirty(true);
                        }}
                      >
                        <option value="unreviewed">Unreviewed</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="needs_followup">Needs follow-up</option>
                      </select>
                    </label>
                    <label className="field">
                      Plain-text note
                      <textarea
                        rows={6}
                        value={note}
                        placeholder="What might explain this interval? Add observations or a follow-up question."
                        onChange={(e) => {
                          setNote(e.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    <div className="form-footer">
                      <span className="small muted">
                        {Array.from(note).length} / 2,000 characters · revision{" "}
                        {revision}
                        {dirty ? " · unsaved" : ""}
                      </span>
                      <button
                        className="button primary"
                        disabled={
                          busy || !dirty || Array.from(note).length > 2000
                        }
                      >
                        <Save size={16} />
                        {busy ? "Saving…" : "Save review"}
                      </button>
                    </div>
                  </form>
                  {feedback && (
                    <p role="status" className="notice">
                      {feedback}
                    </p>
                  )}
                  {conflict && (
                    <div className="conflict">
                      <strong>
                        Latest server note · revision {conflict.revision}
                      </strong>
                      <p className="plain-text">{conflict.note || "No note"}</p>
                      <div className="inline-controls">
                        <button
                          className="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(note);
                            setFeedback("Your draft was copied.");
                          }}
                        >
                          <Copy size={15} />
                          Copy draft
                        </button>
                        <button
                          className="button"
                          onClick={() => {
                            setRevision(conflict.revision);
                            setNote(conflict.note);
                            setStatus(conflict.status);
                            setDirty(false);
                            setConflict(null);
                            eventQuery.refetch();
                          }}
                        >
                          Load latest review
                        </button>
                      </div>
                    </div>
                  )}
                  {mode === "demo" && (
                    <Notice>
                      Synthetic notes are kept in this browser session’s memory
                      and reset on refresh. API mode saves notes with revision
                      checks.
                    </Notice>
                  )}
                </Panel>
                <Panel
                  title="Evidence provenance"
                  subtitle="Authoritative identity is taken from the event."
                >
                  <dl className="facts">
                    <div>
                      <dt>Dataset</dt>
                      <dd>
                        <code>{event.dataset_id}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Run</dt>
                      <dd>
                        <code>{event.run_id}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Detector</dt>
                      <dd>{event.detector}</dd>
                    </div>
                    <div>
                      <dt>Checkpoint revision</dt>
                      <dd>{run.data?.data.model_revision ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Config hash</dt>
                      <dd>
                        <code>
                          {run.data?.data.config_hash ?? "Unavailable"}
                        </code>
                      </dd>
                    </div>
                  </dl>
                  <Notice>
                    Alternative explanations include ordinary household
                    activity, missing data or forecast error. No individual
                    appliance is identified.
                  </Notice>
                  <Link
                    className="button"
                    href={href("/reports", { events: event.id })}
                  >
                    Prepare event evidence report
                  </Link>
                </Panel>
              </div>
              <Panel
                title="Interval evidence table"
                subtitle="The chart, table and exported evidence use the same source dates."
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Source time</th>
                        <th>Observed kW</th>
                        <th>Forecast kW</th>
                        <th>Reference kW</th>
                        <th>Score · {event.score_unit}</th>
                        <th>Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bins.data?.data.map((bin) => {
                        const score = scores.data?.data.find(
                          (s) => s.bin_start === bin.bin_start,
                        );
                        return (
                          <tr key={bin.bin_start}>
                            <td>
                              <Link
                                className="table-link"
                                href={href("/forecasting", {
                                  origin: bin.bin_start,
                                  forecast_mode: "backtest",
                                })}
                              >
                                {sourceLabel(bin.bin_start)}
                              </Link>
                            </td>
                            <td>{number(bin.active_power_kw)}</td>
                            <td>{number(score?.predicted_kw)}</td>
                            <td>{number(score?.baseline_kw)}</td>
                            <td>{number(score?.score)}</td>
                            <td>
                              {bin.quality} ·{" "}
                              {score?.status.replaceAll("_", " ") ??
                                "not scored"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )
        )}
      </QueryState>
    </>
  );
}

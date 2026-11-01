"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import type { CandidateEvent, Score, Bin } from "@/lib/types";
import { AnalysisGate } from "@/components/analysis-gate";
import {
  PageTitle,
  Panel,
  QueryState,
  Empty,
  Notice,
  Badge,
} from "@/components/ui";
import { ScoreChart, TimeSeries } from "@/components/charts";
import { EventTable } from "@/components/events";
import { ExportButton } from "@/components/jobs";
export function AnomaliesPage() {
  const { ready, run, dataset, mode, filters, update, href } = useSelection();
  const enabled = ready && !!run;
  const scores = useResource<Score[]>("scores", enabled);
  const residualScores = useResource<Score[]>("scores", enabled, undefined, {
    detector: "chronos_residual",
  });
  const robustScores = useResource<Score[]>("scores", enabled, undefined, {
    detector: "statistical",
  });
  const events = useResource<CandidateEvent[]>("events", enabled);
  const bins = useResource<Bin[]>("series", enabled);
  const [selected, setSelected] = useState("");
  const event = events.data?.data.find((e) => e.id === selected);
  const eligible =
    scores.data?.data.filter((s) => s.status === "scored").length ?? 0;
  const relativeScores = useMemo<[string, number | null][]>(() => {
    return (residualScores.data?.data ?? []).map((score) => {
      const actual = score.actual_kw;
      const expected = score.predicted_kw;
      return [
        score.bin_start,
        actual != null && expected != null
          ? (Math.abs(actual - expected) / Math.max(Math.abs(expected), 0.1)) * 100
          : null,
      ];
    });
  }, [residualScores.data]);
  const calibrated =
    !scores.data?.data.some((s) => s.status === "not_calibrated") &&
    !(mode === "demo" && filters.detector !== "chronos_residual");
  const outsideScoredPeriod =
    !!run &&
    (filters.to <= run.test_from || filters.from >= run.test_to);
  return (
    <>
      <PageTitle
        eyebrow="ANALYSIS / ANOMALIES"
        title="Unusual. Worth a closer look."
        description="Review candidate periods under a saved detector threshold. These are not verified faults."
        action={
          <ExportButton
            kind="events"
            disabled={!events.data?.data.length}
            rows={events.data?.data.map((e) => ({
              event_id: e.id,
              start_source_time: e.start,
              end_source_time: e.end,
              duration_minutes: e.duration_minutes,
              peak_score: e.peak_score,
              score_unit: e.score_unit,
              direction: e.direction,
              estimated_above_reference_kwh: e.estimated_above_reference_kwh,
              review_status: e.review.status,
            }))}
          />
        }
      />
      <AnalysisGate>
        <div className="filter-bar">
          <label className="field inline">
            Detector
            <select
              value={filters.detector}
              onChange={(e) => {
                setSelected("");
                update({ detector: e.target.value, cursor: null });
              }}
            >
              <option value="chronos_residual">
                {mode === "demo" || run?.model_id === "chronos_bolt_tiny"
                  ? "Chronos one-step residual"
                  : `${run?.model_id.replaceAll("_", " ") ?? "Model"} one-step residual`}
              </option>
              <option value="statistical">
                Statistical reference deviation
              </option>
              <option value="autoencoder" disabled>
                Optional reconstruction · experiment required
              </option>
            </select>
          </label>
          <label className="field inline">
            Direction
            <select
              value={filters.direction}
              onChange={(e) =>
                update({ direction: e.target.value, cursor: null })
              }
            >
              <option value="all">All directions</option>
              <option value="higher">Higher</option>
              <option value="lower">Lower</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="field inline">
            Review
            <select
              value={filters.review}
              onChange={(e) => update({ review: e.target.value, cursor: null })}
            >
              <option value="all">All statuses</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
              <option value="needs_followup">Needs follow-up</option>
            </select>
          </label>
          <label className="field inline">
            Sort
            <select
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value, cursor: null })}
            >
              <option value="newest">Newest first</option>
              <option value="score">Highest score</option>
              <option value="duration">Longest duration</option>
            </select>
          </label>
          <label className="field inline">
            Min peak score
            <input
              type="number"
              step="0.01"
              min={0}
              value={filters.min_score}
              onChange={(e) =>
                update({ min_score: e.target.value, cursor: null })
              }
            />
          </label>
          <button
            className="text-button"
            onClick={() =>
              update({
                direction: "all",
                review: "all",
                sort: "newest",
                min_score: null,
                cursor: null,
              })
            }
          >
            Reset
          </button>
        </div>
        {!calibrated && (
          <Notice>
            This detector is not calibrated in the selected run. Evaluate and
            save its validation threshold to enable candidates.
          </Notice>
        )}
        {outsideScoredPeriod && run && (
          <Notice>
            The selected dates are outside this run&apos;s scored test period:
            {" "}{run.test_from.replace("T", " ")} to{" "}
            {run.test_to.replace("T", " ")}. Choose dates that overlap this
            period to view anomaly scores and candidate events.{" "}
            <button
              className="text-button"
              onClick={() => update({ from: run.test_from, to: run.test_to, cursor: null })}
            >
              Use scored period
            </button>
          </Notice>
        )}
        <Panel
          title={
            filters.detector === "chronos_residual"
              ? "Three anomaly scores"
              : "Statistical detector scores"
          }
          subtitle={
            filters.detector === "chronos_residual"
              ? "Forecast residual (kW), relative deviation (%), and robust z-score (sigma). Each line uses a separate scale."
              : "Score units and saved threshold belong to this detector, independently of forecast residuals."
          }
          action={<Badge>{eligible} eligible scored bins</Badge>}
        >
          <QueryState query={scores}>
            {scores.data?.data.length ? (
              <ScoreChart
                scores={residualScores.data?.data ?? []}
                relativeScores={relativeScores}
                robustScores={robustScores.data?.data ?? []}
              />
            ) : (
              <Empty
                title={
                  calibrated
                    ? "This period has not been scored"
                    : "Detector not calibrated"
                }
              >
                No eligible scores are available. This cannot be interpreted as
                normal consumption.
              </Empty>
            )}
          </QueryState>
        </Panel>
        <Panel
          title="Candidate event review"
          subtitle="Filter results keep whole-event facts and indicate intersections with your date range."
        >
          <QueryState query={events}>
            {events.data?.data.length ? (
              <EventTable
                events={events.data.data}
                selected={event?.id}
                onSelect={setSelected}
              />
            ) : (
              <Empty
                title={
                  eligible
                    ? "No candidate events match these filters"
                    : "No eligible scored intervals"
                }
              >
                {eligible
                  ? `${eligible} intervals scored under the saved threshold. Try resetting review and direction filters.`
                  : "Prepare a calibrated run or select a scored period."}
              </Empty>
            )}
            {events.data?.meta.next_cursor && (
              <div className="panel-actions">
                <button
                  className="button"
                  onClick={() =>
                    update({ cursor: events.data?.meta.next_cursor ?? null })
                  }
                >
                  Next page
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
            {filters.cursor && (
              <button
                className="text-button"
                onClick={() => update({ cursor: null })}
              >
                Return to first page
              </button>
            )}
          </QueryState>
        </Panel>
        {event && (
          <Panel
            key={event.id}
            className="event-preview"
            title={`Selected interval · ${event.direction} consumption`}
            subtitle="Whole-event period and surrounding observations."
            action={
              <Link className="button" href={href(`/anomalies/${event.id}`)}>
                Open full evidence
                <ArrowRight size={15} />
              </Link>
            }
          >
            {bins.data && (
              <TimeSeries
                bins={bins.data.data.filter(
                  (b) => b.bin_start >= event.start && b.bin_start < event.end,
                )}
                scores={scores.data?.data}
                events={[event]}
              />
            )}
          </Panel>
        )}
        {!dataset?.capabilities.autoencoder && (
          <p className="small muted">
            Optional autoencoder requires complete four-channel windows and an
            evaluated experiment. Its two-hour window support stays separate
            from interval candidate KPIs.
          </p>
        )}
      </AnalysisGate>
    </>
  );
}

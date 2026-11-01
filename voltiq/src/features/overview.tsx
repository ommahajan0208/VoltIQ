"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import { addSourceMinutes } from "@/lib/time";
import type { Bin, Score, CandidateEvent, Overview } from "@/lib/types";
import { AnalysisGate } from "@/components/analysis-gate";
import { Panel, Metric, PageTitle, QueryState, Empty } from "@/components/ui";
import { TimeSeries } from "@/components/charts";
import { EventTable } from "@/components/events";
export function OverviewPage() {
  const { ready, run, filters, href } = useSelection();
  const router = useRouter();
  const enabled = ready && !!run;
  const overview = useResource<Overview>("overview", enabled);
  const bins = useResource<Bin[]>("series", enabled);
  const scores = useResource<Score[]>("scores", enabled);
  const events = useResource<CandidateEvent[]>("events", enabled, undefined, {
    direction: "all",
    review: "all",
    min_score: "",
    cursor: "",
  });
  const kpi = overview.data?.data;
  return (
    <>
      <PageTitle
        eyebrow="ANALYSIS / OVERVIEW"
        title="See the whole picture."
        description="Observed consumption, scored coverage and unusual intervals in one place."
        action={
          <Link href={href("/forecasting")} className="button">
            Open forecasting
            <ArrowUpRight size={16} />
          </Link>
        }
      />
      <AnalysisGate>
        <QueryState query={overview}>
          <div className="metrics-grid">
            <Metric
              label="Observed energy"
              value={kpi?.observed_energy_kwh}
              unit="kWh"
              detail="Sum of valid observed minute readings"
              accent
            />
            <Metric
              label="Overnight observed energy"
              value={kpi?.overnight_observed_energy_kwh}
              unit="kWh"
              detail="00:00–05:00 · source household time"
            />
            <Metric
              label="Candidate events"
              value={kpi?.candidate_count}
              unit="events"
              detail="Distinct intersecting primary residual events"
            />
            <Metric
              label="Eligible scored intervals"
              value={kpi?.eligible_scored_bins}
              unit="bins"
              detail={`${kpi?.expected_bins ?? "—"} selected 15-minute intervals`}
            />
          </div>
        </QueryState>
        <Panel
          title="Your consumption timeline"
          subtitle="Observed power and causal one-step forecasts. Amber markers open candidate evidence."
          action={
            <Link className="text-button" href={href("/consumption")}>
              Explore consumption
              <ArrowRight size={15} />
            </Link>
          }
        >
          <QueryState query={bins}>
            <QueryState query={scores}>
              <QueryState query={events}>
                {bins.data?.data.length ? (
                  <TimeSeries
                    bins={bins.data.data}
                    scores={scores.data?.data}
                    events={events.data?.data}
                    onEvent={(id) => router.push(href(`/anomalies/${id}`))}
                    onRange={(from, to) =>
                      router.push(
                        href("/consumption", {
                          from,
                          to: addSourceMinutes(to, 15),
                        }),
                      )
                    }
                  />
                ) : (
                  <Empty title="No observations in this range">
                    Choose another date range. No missing readings are filled
                    with zero.
                  </Empty>
                )}
              </QueryState>
            </QueryState>
          </QueryState>
        </Panel>
        <div className="overview-bottom">
          <Panel
            title="Candidate intervals to inspect"
            subtitle="Unusual consumption is a prompt for review, not a confirmed fault."
            action={
              <Link className="text-button" href={href("/anomalies")}>
                View all
                <ArrowRight size={15} />
              </Link>
            }
          >
            <QueryState query={events}>
              {events.data?.data.length ? (
                <EventTable events={events.data.data.slice(0, 4)} />
              ) : (
                <Empty
                  title={
                    kpi?.eligible_scored_bins
                      ? "No candidates in this period"
                      : "This period has not been scored"
                  }
                >
                  {kpi?.eligible_scored_bins
                    ? `${kpi.eligible_scored_bins} eligible intervals were scored under the saved threshold.`
                    : "There are no eligible scored intervals for this range."}
                </Empty>
              )}
            </QueryState>
          </Panel>
          <Panel
            title="Evidence coverage"
            subtitle="Quality remains part of every result."
          >
            <div className="coverage-number">
              {kpi ? `${(kpi.coverage * 100).toFixed(1)}%` : "—"}
            </div>
            <p className="muted">
              Observed minute coverage in the selected period
            </p>
            <div className="coverage-track">
              <span style={{ width: `${(kpi?.coverage ?? 0) * 100}%` }} />
            </div>
            <ul className="quality-legend">
              <li>
                <i className="dot cyan-dot" />
                Complete observations
              </li>
              <li>
                <i className="dot amber-dot" />
                Partial observations
              </li>
              <li>
                <i className="dot neutral-dot" />
                Missing / quality excluded
              </li>
            </ul>
            <p className="small muted">
              Quality-excluded intervals cannot be labelled normal.
              Reference-energy estimates describe a historical comparison, not
              measured savings.
            </p>
            <div className="identity-line">
              <span>Selected run</span>
              <code>{filters.run}</code>
            </div>
          </Panel>
        </div>
      </AnalysisGate>
    </>
  );
}

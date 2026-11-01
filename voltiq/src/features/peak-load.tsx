"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import type { PeakAnalysis } from "@/lib/types";
import { number, sourceTimestampLabel } from "@/lib/time";
import { AnalysisGate } from "@/components/analysis-gate";
import { PageTitle, Panel, QueryState, Metric, Badge, Empty } from "@/components/ui";
import { PeakLoadChart } from "@/components/charts";
export function PeakLoadPage() {
  const { ready, dataset, filters, href } = useSelection();
  const peaks = useResource<PeakAnalysis>("peaks", ready && !!dataset);
  const analysis = peaks.data?.data;
  return (
    <>
      <PageTitle
        eyebrow="ANALYSIS / PEAK LOAD"
        title="Find the moments that matter."
        description="Dynamic demand thresholds reveal repeated high-load periods without treating every busy interval as a fault."
        action={
          <Link className="button" href={href("/recommendations")}>
            View recommendations <ArrowRight size={15} />
          </Link>
        }
      />
      <AnalysisGate requireRun={false}>
        <QueryState query={peaks}>
          {!analysis ? (
            <Empty title="No peak analysis available">Select a valid dataset range to calculate dynamic peak evidence.</Empty>
          ) : (
            <>
              <div className="metrics-grid">
                <Metric label="Peak demand" value={analysis.peak_kw} unit="kW" detail="Highest detected demand in the selected period" accent />
                <Metric label="Dynamic threshold" value={analysis.threshold_kw} unit="kW" detail={`${number(analysis.percentile * 100)}th percentile of valid demand`} />
                <Metric label="Peak periods" value={analysis.peak_count} unit="events" detail="Grouped intervals above the dynamic threshold" />
                <Metric label="Excess over median" value={analysis.excess_over_median_kwh} unit="kWh" detail="Estimated excess relative to the selected-period median" />
              </div>
              <Panel title="Peak-load profile" subtitle={`Source household time · ${sourceTimestampLabel(filters.from)} to ${sourceTimestampLabel(filters.to)} (end exclusive)`} action={<Badge>{number(analysis.coverage * 100)}% coverage</Badge>}>
                <PeakLoadChart analysis={analysis} />
              </Panel>
              <Panel title="Detected peak periods" subtitle="These are dynamic threshold crossings, not verified faults.">
                {analysis.events.length ? (
                  <div className="table-scroll"><table><caption className="sr-only">Detected peak periods in source household time</caption><thead><tr><th>Start</th><th>End</th><th>Peak time</th><th>Duration</th><th>Peak kW</th><th>Energy</th><th>Excess estimate</th></tr></thead><tbody>{analysis.events.map((event) => <tr key={event.id}><td>{sourceTimestampLabel(event.start)}</td><td>{sourceTimestampLabel(event.end)}</td><td>{sourceTimestampLabel(event.peak_at)}</td><td>{event.duration_minutes} min</td><td>{number(event.peak_kw)} kW</td><td>{number(event.energy_kwh)} kWh</td><td>{number(event.excess_over_median_kwh)} kWh</td></tr>)}</tbody></table></div>
                ) : <Empty title="No dynamic peaks detected">No valid interval crossed the configured percentile threshold in this range.</Empty>}
              </Panel>
              <p className="small muted">Peak evidence describes demand patterns. It does not identify a specific appliance or guarantee savings.</p>
            </>
          )}
        </QueryState>
      </AnalysisGate>
    </>
  );
}
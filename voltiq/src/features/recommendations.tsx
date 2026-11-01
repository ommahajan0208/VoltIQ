"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import type { RecommendationResult } from "@/lib/types";
import { number, sourceTimestampLabel } from "@/lib/time";
import { AnalysisGate } from "@/components/analysis-gate";
import { PageTitle, Panel, QueryState, Badge, Empty, Notice } from "@/components/ui";
const tone = { high: "error", medium: "amber", low: "neutral" } as const;
export function RecommendationsPage() {
  const { ready, run, filters, href } = useSelection();
  const result = useResource<RecommendationResult>("recommendations", ready && !!run);
  const data = result.data?.data;
  return (
    <>
      <PageTitle eyebrow="WORKSPACE / RECOMMENDATIONS" title="Actions backed by evidence." description="Transparent rules turn dynamic household evidence into reviewable next steps. Recommendations are advisory, not guaranteed savings." action={<Link className="button" href={href("/peak-load")}>Open peak analysis <ArrowRight size={15} /></Link>} />
      <AnalysisGate>
        <QueryState query={result}>
          {!data ? <Empty title="No recommendations available">Select a completed held-out run and a scored date range.</Empty> : <>
            <Panel title="Evidence summary" subtitle={`${sourceTimestampLabel(filters.from)} to ${sourceTimestampLabel(filters.to)} (end exclusive)`}>
              <div className="facts"><div><dt>Peak threshold</dt><dd>{number(data.peak_summary.threshold_kw)} kW</dd></div><div><dt>Peak periods</dt><dd>{data.peak_summary.peak_count}</dd></div><div><dt>Peak demand</dt><dd>{number(data.peak_summary.peak_kw)} kW</dd></div><div><dt>Coverage</dt><dd>{number((data.peak_summary.coverage ?? 0) * 100)}%</dd></div></div>
            </Panel>
            {data.recommendations.length ? <div className="two-columns">{data.recommendations.map((recommendation) => <Panel key={recommendation.id} title={recommendation.title} subtitle={recommendation.category.replaceAll("_", " ")} action={<Badge tone={tone[recommendation.severity]}>{recommendation.severity}</Badge>}><p>{recommendation.rationale}</p><p><strong>Suggested next step:</strong> {recommendation.action}</p><p className="small"><strong>Confidence:</strong> {recommendation.confidence}</p><dl className="facts">{Object.entries(recommendation.evidence).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{Array.isArray(value) ? value.map((window, index) => <span className="block" key={`${window.peak_at ?? window.start}-${index}`}>Peak {sourceTimestampLabel(window.peak_at ?? window.start)} · {number(window.peak_kw)} kW · window {sourceTimestampLabel(window.start)} to {sourceTimestampLabel(window.end)}</span>) : typeof value === "number" ? number(value) : value ?? "Unavailable"}</dd></div>)}</dl><Notice>{recommendation.limitation}</Notice></Panel>)}</div> : <Empty title="No rules were triggered">No recommendation rule passed its explicit evidence conditions for this selected period.</Empty>}
            <p className="small muted">Rules use dynamic baselines and explicit conditions. They do not identify appliances, prove faults, or guarantee savings.</p>
          </>}
        </QueryState>
      </AnalysisGate>
    </>
  );
}
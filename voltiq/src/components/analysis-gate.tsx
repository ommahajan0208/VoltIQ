"use client";
import type { ReactNode } from "react";
import { useSelection } from "@/lib/state";
import { Empty, QueryState } from "./ui";
export function AnalysisGate({
  children,
  requireRun = true,
}: {
  children: ReactNode;
  requireRun?: boolean;
}) {
  const selection = useSelection();
  return (
    <QueryState query={selection.datasets}>
      {!selection.dataset ? (
        <Empty
          title={
            selection.filters.dataset
              ? "Dataset unavailable"
              : "Your workspace starts with data"
          }
          href={selection.href("/data")}
        >
          Choose a registered dataset or upload compatible minute-resolution
          readings.
        </Empty>
      ) : selection.dataset.status !== "ready" ? (
        <Empty
          title="This dataset is not ready yet"
          href={selection.href("/data")}
          action="Open pipeline activity"
        >
          Complete mapping and processing before exploring observations.
        </Empty>
      ) : requireRun && !selection.run ? (
        <QueryState query={selection.runs}>
          <Empty
            title="A completed analysis run is required"
            href={selection.href("/data")}
            action="Prepare analysis"
          >
            Explore consumption now, or evaluate the required models to produce
            saved forecasts and candidate events.
          </Empty>
        </QueryState>
      ) : requireRun && selection.run?.evaluation_kind === "inference" ? (
        <Empty
          title="This is an inference-only run"
          href={selection.href("/forecasting")}
          action="Open forecasting"
        >
          Inference runs provide forecasts without held-out metrics or
          calibrated anomaly results. Queue a held-out evaluation to enable this
          page.
        </Empty>
      ) : !selection.ready ? (
        <div className="skeleton" aria-label="Resolving date range">
          <span />
          <span />
        </div>
      ) : (
        children
      )}
    </QueryState>
  );
}

"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { Bin, CandidateEvent, ForecastPoint, PeakAnalysis, Score } from "@/lib/types";
import { number, sourceLabel, sourceTimestampLabel } from "@/lib/time";
import { usePreferences } from "./providers";
const Chart = dynamic(() => import("./chart").then((m) => m.Chart), {
  ssr: false,
  loading: () => (
    <div className="skeleton" aria-label="Loading chart">
      <span />
      <span />
      <span />
    </div>
  ),
});
import {
  chartPalette as palette,
  darkChartPalette as colors,
} from "@/lib/chart-theme";
function axisTime(value: string): number {
  return Date.parse(value + "Z");
}
function axisLabel(value: number): string {
  return new Date(value).toISOString().slice(0, 19);
}
function base(labels: string[], unit: string, light: boolean, exactTimestamps = false): EChartsOption {
  return {
    grid: { left: 52, right: 24, top: 35, bottom: 65 },
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      backgroundColor: light ? "#fff" : "#132236",
      borderColor: "#26374B",
      textStyle: { color: light ? "#142b43" : "#EDF5FC" },
      formatter: (items: unknown) => {
        const list = (Array.isArray(items) ? items : [items]) as {
          axisValue: number;
          seriesName: string;
          value: [number, number | null];
        }[];
        if (!list.length) return "";
        return [
          (exactTimestamps ? sourceTimestampLabel : sourceLabel)(axisLabel(Number(list[0].axisValue))),
          ...list
            .filter(
              (p) =>
                p.seriesName !== "Band lower" &&
                p.seriesName !== "q10–q90 range",
            )
            .map(
              (p) =>
                `${p.seriesName}: ${p.value?.[1] == null ? "Unavailable" : number(p.value[1]) + " " + unit}`,
            ),
        ].join("\n");
      },
      axisPointer: {
        type: "line",
        label: {
          formatter: (p: { value: string | number | Date }) =>
            (exactTimestamps ? sourceTimestampLabel : sourceLabel)(axisLabel(Number(p.value))),
        },
      },
    },
    legend: {
      top: 0,
      textStyle: { color: light ? "#364d64" : "#A0B2C6" },
      itemWidth: 16,
      itemHeight: 4,
    },
    xAxis: {
      type: "time",
      min: labels.length ? axisTime(labels[0]) : undefined,
      max: labels.length ? axisTime(labels[labels.length - 1]) : undefined,
      axisLabel: {
        color: light ? "#364d64" : "#A0B2C6",
        formatter: (v: number) =>
          axisLabel(v).slice(5, 10) + " " + axisLabel(v).slice(11, 16),
      },
      axisLine: { lineStyle: { color: "#26374B" } },
    },
    yAxis: {
      type: "value",
      name: unit,
      nameTextStyle: { color: light ? "#364d64" : "#A0B2C6" },
      axisLabel: { color: light ? "#364d64" : "#A0B2C6" },
      splitLine: { lineStyle: { color: light ? "#dfe6ee" : "#1b2b3e" } },
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      {
        type: "slider",
        height: 18,
        bottom: 8,
        showDetail: false,
        borderColor: "#26374B",
        fillerColor: "rgba(69,223,245,.08)",
        handleStyle: { color: colors.observed },
      },
    ],
  };
}

export function TimeSeries({
  bins,
  scores = [],
  events = [],
  channel = "active_power_kw",
  onEvent,
  onRange,
  syncGroup,
}: {
  bins: Bin[];
  scores?: Score[];
  events?: CandidateEvent[];
  channel?:
    "active_power_kw" | "reactive_power_kvar" | "voltage_v" | "current_a";
  onEvent?: (id: string) => void;
  onRange?: (from: string, to: string) => void;
  syncGroup?: string;
}) {
  const { light } = usePreferences();
  const unit = {
    active_power_kw: "kW",
    reactive_power_kvar: "kVAR",
    voltage_v: "V",
    current_a: "A",
  }[channel];
  const option = useMemo<EChartsOption>(() => {
    const colors = palette(light);
    const labels = bins.map((b) => b.bin_start);
    const lookup = new Map(scores.map((s) => [s.bin_start, s]));
    const unscored = bins.filter(
      (b) =>
        lookup.has(b.bin_start) && lookup.get(b.bin_start)?.status !== "scored",
    );
    return {
      ...base(labels, unit, light),
      legend: {
        data: [
          "Observed",
          ...(channel === "active_power_kw" &&
          scores.some((s) => s.predicted_kw != null)
            ? ["One-step forecast"]
            : []),
          ...(events.length ? ["Candidate"] : []),
        ],
        textStyle: { color: light ? "#364d64" : "#A0B2C6" },
      },
      series: [
        {
          type: "line",
          name: "Observed",
          data: bins.map((b) => [axisTime(b.bin_start), b[channel]]),
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: colors.observed, width: 2 },
          itemStyle: { color: colors.observed },
          areaStyle: { color: "rgba(69,223,245,.035)" },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(160,178,198,.10)" },
            data: unscored.map((b) => [
              { xAxis: axisTime(b.bin_start) },
              { xAxis: axisTime(b.bin_end) },
            ]),
          },
        },
        {
          type: "line",
          name: "One-step forecast",
          data: bins.map((b) => [
            axisTime(b.bin_start),
            channel === "active_power_kw"
              ? (lookup.get(b.bin_start)?.predicted_kw ?? null)
              : null,
          ]),
          showSymbol: false,
          lineStyle: { color: colors.forecast, type: "dashed", width: 1.5 },
          itemStyle: { color: colors.forecast },
        },
        {
          type: "scatter",
          name: "Candidate",
          symbol: "diamond",
          symbolSize: 10,
          itemStyle: { color: colors.candidate },
          data: events
            .filter(
              (e) =>
                bins.length &&
                e.start >= bins[0].bin_start &&
                e.start < bins[bins.length - 1].bin_end,
            )
            .map((e) => ({
              event_id: e.id,
              value: [
                axisTime(e.start),
                bins.find(
                  (b) => b.bin_start <= e.start && b.bin_end > e.start,
                )?.[channel] ?? null,
              ],
            })),
        },
      ],
    };
  }, [bins, scores, events, channel, unit, light]);
  return (
    <>
      <Chart
        option={option}
        label={`Measured ${unit} · source household time`}
        onEvent={onEvent}
        onRange={onRange}
        rangeLabels={bins.map((b) => b.bin_start)}
        syncGroup={syncGroup}
      />
      <DataAlternative
        rows={bins.map((b) => ({
          time: b.bin_start,
          value: b[channel],
          quality:
            channel === "active_power_kw"
              ? b.quality
              : "Per-channel coverage unavailable",
        }))}
        unit={unit}
      />
    </>
  );
}
export function ForecastChart({
  context,
  points,
  origin,
  baselines,
}: {
  context: Bin[];
  points: ForecastPoint[];
  origin: string;
  baselines: boolean;
}) {
  const { light } = usePreferences();
  const option = useMemo<EChartsOption>(() => {
    const colors = palette(light);
    const contextSeries = context
      .map((b) => [
        axisTime(b.bin_start),
        b.active_power_kw == null ? null : Number(b.active_power_kw),
      ] as [number, number | null])
      .filter(([time]) => Number.isFinite(time));
    const targetSeries = points.map(
      (p) =>
        [
          axisTime(p.target_start),
          p.target_eligible && p.actual_kw != null ? Number(p.actual_kw) : null,
        ] as [number, number | null],
    );
    const labels = [
      ...context.map((b) => b.bin_start),
      ...points.map((p) => p.target_start),
    ];
    const prefix = contextSeries.map(([time]) => [time, null]);
    return {
      ...base(labels, "kW", light),
      legend: {
        data: [
          "Observed context",
          "Observed target",
          "Forecast median",
          "q10–q90 range",
          ...(baselines ? ["Persistence", "Seasonal naive"] : []),
        ],
        textStyle: { color: light ? "#364d64" : "#A0B2C6" },
      },
      series: [
        {
          type: "line",
          name: "Observed context",
          data: contextSeries,
          connectNulls: true,
          showSymbol: false,
          lineStyle: { color: colors.observed, width: 2 },
          itemStyle: { color: colors.observed },
        },
        {
          type: "line",
          name: "Observed target",

          data: targetSeries,

          showSymbol: false,
          lineStyle: { color: colors.observed, width: 2 },
          itemStyle: { color: colors.observed },
        },
        {
          type: "line",
          name: "Forecast median",
          data: [
            ...prefix,
            ...points.map((p) => [axisTime(p.target_start), p.q50_kw]),
          ],
          showSymbol: false,
          lineStyle: { color: colors.forecast, type: "dashed", width: 2 },
          itemStyle: { color: colors.forecast },
          markLine: {
            symbol: "none",
            label: { formatter: "Origin", color: colors.reference },
            lineStyle: { color: colors.reference },
            data: [{ xAxis: axisTime(origin) }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(166,164,255,.025)" },
            data: points.length
              ? [
                  [
                    { xAxis: axisTime(origin) },
                    { xAxis: axisTime(points[points.length - 1].target_start) },
                  ],
                ]
              : [],
          },
        },
        {
          type: "line",
          name: "Band lower",
          stack: "band",
          data: [
            ...prefix,
            ...points.map((p) => [axisTime(p.target_start), p.q10_kw]),
          ],
          showSymbol: false,
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          type: "line",
          name: "q10–q90 range",
          stack: "band",
          data: [
            ...prefix,
            ...points.map((p) => [
              axisTime(p.target_start),
              p.q10_kw != null && p.q90_kw != null ? p.q90_kw - p.q10_kw : null,
            ]),
          ],
          showSymbol: false,
          lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(166,164,255,.18)" },
          tooltip: { show: false },
        },
        ...(baselines
          ? [
              {
                type: "line" as const,
                name: "Persistence",
                data: [
                  ...prefix,
                  ...points.map((p) => [
                    axisTime(p.target_start),
                    p.persistence_kw,
                  ]),
                ],
                showSymbol: false,
                lineStyle: { color: colors.reference, type: "dashed" as const },
              },
              {
                type: "line" as const,
                name: "Seasonal naive",
                data: [
                  ...prefix,
                  ...points.map((p) => [
                    axisTime(p.target_start),
                    p.seasonal_naive_kw,
                  ]),
                ],
                showSymbol: false,
                lineStyle: { color: "#77D6AD", type: "dotted" as const },
              },
            ]
          : []),
      ],
    };
  }, [context, points, origin, baselines, light]);
  return (
    <Chart
      option={option}
      label="Observed context · forecast median · q10–q90 forecast range"
    />
  );
}
export function PeakLoadChart({ analysis }: { analysis: PeakAnalysis }) {
  const { light } = usePreferences();
  const option = useMemo<EChartsOption>(() => {
    const colors = palette(light);
    const labels = analysis.series.map((point) => point.time);
    return {
      ...base(labels, "kW", light, true),
      legend: {
        data: ["Observed demand", "Dynamic baseline", "Peak threshold"],
        textStyle: { color: light ? "#364d64" : "#A0B2C6" },
      },
      series: [
        {
          type: "line",
          name: "Observed demand",
          data: analysis.series.map((point) => [axisTime(point.time), point.observed_kw]),
          showSymbol: false,
          lineStyle: { color: colors.observed, width: 2 },
          itemStyle: { color: colors.observed },
        },
        {
          type: "line",
          name: "Dynamic baseline",
          data: analysis.series.map((point) => [axisTime(point.time), point.baseline_kw]),
          showSymbol: false,
          lineStyle: { color: colors.forecast, type: "dashed", width: 1.5 },
          itemStyle: { color: colors.forecast },
        },
        {
          type: "line",
          name: "Peak threshold",
          data: analysis.series.map((point) => [axisTime(point.time), point.threshold_kw]),
          showSymbol: false,
          lineStyle: { color: colors.candidate, type: "dashed", width: 1.5 },
          itemStyle: { color: colors.candidate },
        },
      ],
    };
  }, [analysis, light]);
  return <Chart option={option} label="Peak load, dynamic baseline, and percentile threshold" />;
}export function ScoreChart({
  scores,
  relativeScores = [],
  robustScores = [],
  syncGroup,
}: {
  scores: Score[];
  relativeScores?: [string, number | null][];
  robustScores?: Score[];
  syncGroup?: string;
}) {
  const { light } = usePreferences();
  const option = useMemo<EChartsOption>(() => {
    const colors = palette(light);
    const residualThreshold = scores.find((s) => s.threshold != null)?.threshold;
    const robustThreshold = robustScores.find((s) => s.threshold != null)?.threshold;
    return {
      ...base(scores.map((s) => s.bin_start), "score", light),
      grid: { left: 62, right: 112, top: 35, bottom: 65 },
      yAxis: [
        {
          type: "value",
          name: "kW",
          nameTextStyle: { color: light ? "#364d64" : "#A0B2C6" },
          axisLabel: { color: light ? "#364d64" : "#A0B2C6" },
          splitLine: { lineStyle: { color: light ? "#dfe6ee" : "#1b2b3e" } },
        },
        {
          type: "value",
          name: "%",
          position: "right",
          nameTextStyle: { color: colors.candidate },
          axisLabel: { color: colors.candidate, formatter: "{value}%" },
          splitLine: { show: false },
        },
        {
          type: "value",
          name: "sigma",
          position: "right",
          offset: 58,
          nameTextStyle: { color: colors.reference },
          axisLabel: { color: colors.reference },
          splitLine: { show: false },
        },
      ],
      legend: {
        data: ["Forecast residual", "Relative deviation", "Robust z-score"],
        textStyle: { color: light ? "#364d64" : "#A0B2C6" },
      },
      series: [
        {
          type: "line",
          name: "Forecast residual",
          yAxisIndex: 0,
          showSymbol: false,
          data: scores.map((s) => [axisTime(s.bin_start), s.score]),
          lineStyle: { color: colors.forecast, width: 2 },
          itemStyle: { color: colors.forecast },
          markLine: {
            symbol: "none",
            label: { show: false },
            lineStyle: { color: colors.forecast, type: "dashed" },
            data: residualThreshold != null ? [{ yAxis: residualThreshold }] : [],
          },
        },
        {
          type: "line",
          name: "Relative deviation",
          yAxisIndex: 1,
          showSymbol: false,
          data: relativeScores.map(([time, value]) => [axisTime(time), value]),
          lineStyle: { color: colors.candidate, width: 2 },
          itemStyle: { color: colors.candidate },
          markLine: {
            symbol: "none",
            label: { show: false },
            lineStyle: { color: colors.candidate, type: "dashed" },
            data: [{ yAxis: 50 }],
          },
        },
        {
          type: "line",
          name: "Robust z-score",
          yAxisIndex: 2,
          showSymbol: false,
          data: robustScores.map((s) => [axisTime(s.bin_start), s.score]),
          lineStyle: { color: colors.reference, width: 2 },
          itemStyle: { color: colors.reference },
          markLine: {
            symbol: "none",
            label: { show: false },
            lineStyle: { color: colors.reference, type: "dashed" },
            data: robustThreshold != null ? [{ yAxis: robustThreshold }] : [],
          },
        },
      ],
    };
  }, [scores, relativeScores, robustScores, light]);
  return (
    <Chart
      option={option}
      label="Forecast residual, relative deviation, and robust z-score"
      syncGroup={syncGroup}
    />
  );
}
export function SlotChart({
  slots,
}: {
  slots: { slot: string; median_kw: number | null; count: number }[];
}) {
  const { light } = usePreferences();
  const option = useMemo<EChartsOption>(
    () => ({
      ...base(
        slots.map((s) => `2007-01-01T${s.slot}:00`),
        "kW",
        light,
      ),
      series: [
        {
          name: "Median observed power",
          type: "line",
          data: slots.map((s) => [
            axisTime(`2007-01-01T${s.slot}:00`),
            s.median_kw,
          ]),
          showSymbol: false,
          lineStyle: { color: palette(light).observed },
          itemStyle: { color: palette(light).observed },
        },
      ],
    }),
    [slots, light],
  );
  return (
    <Chart option={option} label="Median slot profile · source time of day" />
  );
}
export function DataAlternative({
  rows,
  unit,
}: {
  rows: { time: string; value: number | null; quality?: string }[];
  unit: string;
}) {
  return (
    <details className="data-alternative">
      <summary>Accessible data table · {rows.length} display intervals</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Source time</th>
              <th>Value ({unit})</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.time}>
                <td>{sourceLabel(row.time)}</td>
                <td>{number(row.value)}</td>
                <td>{row.quality ?? "Saved score"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

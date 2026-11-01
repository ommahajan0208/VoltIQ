"use client";
import { useMemo } from "react";
import { usePreferences } from "@/components/providers";
import { chartPalette } from "@/lib/chart-theme";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useResource, useSelection } from "@/lib/state";
import { inclusiveEndToExclusive, number, addSourceMinutes } from "@/lib/time";
import type { Bin, Score, CandidateEvent, Profiles } from "@/lib/types";
import { AnalysisGate } from "@/components/analysis-gate";
import { PageTitle, Panel, QueryState, Empty, Badge } from "@/components/ui";
import { TimeSeries, SlotChart } from "@/components/charts";
import { ExportButton } from "@/components/jobs";
const Chart = dynamic(() => import("@/components/chart").then((m) => m.Chart), {
  ssr: false,
});
function NightCompare({ bins, dates }: { bins: Bin[]; dates: string[] }) {
  const { light } = usePreferences();
  const semantic = chartPalette(light);
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis" },
      legend: { textStyle: { color: semantic.reference } },
      grid: { left: 45, right: 20, bottom: 30 },
      xAxis: {
        type: "category",
        data: Array.from(
          { length: 20 },
          (_, i) =>
            `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
        ),
        axisLabel: { color: semantic.reference },
      },
      yAxis: {
        type: "value",
        name: "kW",
        splitLine: { lineStyle: { color: "#26374B" } },
      },
      series: dates.map((date, i) => ({
        name: date,
        type: "line",
        showSymbol: false,
        data: Array.from(
          { length: 20 },
          (_, k) =>
            bins.find(
              (b) =>
                b.bin_start ===
                `${date}T${String(Math.floor(k / 4)).padStart(2, "0")}:${String((k % 4) * 15).padStart(2, "0")}:00`,
            )?.active_power_kw ?? null,
        ),
        lineStyle: {
          color: [
            semantic.observed,
            semantic.forecast,
            light ? "#14714E" : "#77D6AD",
          ][i],
        },
        itemStyle: {
          color: [
            semantic.observed,
            semantic.forecast,
            light ? "#14714E" : "#77D6AD",
          ][i],
        },
      })),
    }),
    [bins, dates, light],
  );
  return (
    <Chart
      option={option}
      label="Separate historical nights · aligned source time 00:00–05:00"
    />
  );
}
export function ConsumptionPage() {
  const { ready, dataset, run, filters, params, update, href } = useSelection();
  const router = useRouter();
  const bins = useResource<Bin[]>("series", ready);
  const profiles = useResource<Profiles>("profiles", ready);
  const overlay = params.get("overlay") === "1";
  const scores = useResource<Score[]>("scores", ready && !!run && overlay);
  const events = useResource<CandidateEvent[]>(
    "events",
    ready && !!run && overlay,
  );
  const channel = (
    [
      "active_power_kw",
      "reactive_power_kvar",
      "voltage_v",
      "current_a",
    ].includes(params.get("channel") ?? "")
      ? params.get("channel")
      : "active_power_kw"
  ) as "active_power_kw" | "reactive_power_kvar" | "voltage_v" | "current_a";
  const nights = (params.get("nights") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 3);
  return (
    <>
      <PageTitle
        eyebrow="ANALYSIS / CONSUMPTION"
        title="Find your daily rhythm."
        description="Explore measured usage, missingness and the patterns behind each day."
        action={
          <ExportButton
            kind="observations"
            disabled={!bins.data?.data.length}
            rows={bins.data?.data as unknown as Record<string, unknown>[]}
          />
        }
      />
      <AnalysisGate requireRun={false}>
        <Panel
          title="Consumption explorer"
          subtitle="Power is kW; energy is kWh. Missing readings remain gaps."
          action={
            <div className="inline-controls">
              <label className="sr-only" htmlFor="channel">
                Measured channel
              </label>
              <select
                id="channel"
                value={channel}
                onChange={(e) => update({ channel: e.target.value })}
              >
                <option value="active_power_kw">Active power · kW</option>
                <option value="reactive_power_kvar">
                  Reactive power · kVAR
                </option>
                <option value="voltage_v">Voltage · V</option>
                <option value="current_a">Current · A</option>
              </select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={overlay}
                  disabled={!run}
                  onChange={(e) =>
                    update({ overlay: e.target.checked ? "1" : null })
                  }
                />
                Candidate overlay
              </label>
              <button
                className="text-button"
                onClick={() =>
                  update({
                    from: dataset?.from ?? null,
                    to: dataset?.to ?? null,
                    scope: "all",
                  })
                }
              >
                Reset range
              </button>
            </div>
          }
        >
          <QueryState query={bins}>
            {bins.data?.data.some((b) => b[channel] != null) ? (
              <TimeSeries
                bins={bins.data.data}
                channel={channel}
                scores={overlay ? scores.data?.data : []}
                events={overlay ? events.data?.data : []}
                onEvent={(id) => router.push(href(`/anomalies/${id}`))}
                onRange={(from, to) =>
                  update({ from, to: addSourceMinutes(to, 15) })
                }
              />
            ) : (
              <Empty title="This channel has no observations">
                Map an available measured channel or choose a different range.
              </Empty>
            )}
          </QueryState>
          {overlay && scores.isError && (
            <p role="alert" className="error-text">
              Overlay unavailable: {scores.error.message}
            </p>
          )}
        </Panel>
        <div className="two-columns">
          <Panel
            title="Daily observed energy"
            subtitle="Select a day to explore its timeline. Coverage stays visible."
          >
            <QueryState query={profiles}>
              <div className="daily-heatmap">
                {profiles.data?.data.daily.map((day) => (
                  <button
                    key={day.date}
                    className="heatmap-cell"
                    style={{
                      background:
                        day.observed_energy_kwh == null
                          ? "var(--surface-raised)"
                          : `rgba(69,223,245,${Math.min(0.32, 0.05 + (day.observed_energy_kwh ?? 0) / 100)})`,
                    }}
                    onClick={() =>
                      update({
                        from: day.date + "T00:00:00",
                        to: inclusiveEndToExclusive(day.date),
                      })
                    }
                  >
                    <span>{day.date}</span>
                    <strong>
                      {number(day.observed_energy_kwh)}
                      <small> kWh</small>
                    </strong>
                    <small>
                      {(day.coverage * 100).toFixed(1)}% coverage ·{" "}
                      {day.valid_bins} valid bins
                    </small>
                  </button>
                ))}
              </div>
            </QueryState>
            <p className="small muted">
              Partial days represent observed energy only; their totals are not
              full-day usage estimates.
            </p>
          </Panel>
          <Panel
            title="Median daily profile"
            subtitle="Median power per 15-minute slot with valid contributing counts."
          >
            <QueryState query={profiles}>
              {profiles.data && (
                <>
                  <SlotChart slots={profiles.data.data.slots} />
                  <p className="small muted">
                    Contributing counts:{" "}
                    {Math.min(...profiles.data.data.slots.map((s) => s.count))}–
                    {Math.max(...profiles.data.data.slots.map((s) => s.count))}{" "}
                    valid observations per slot.
                  </p>
                </>
              )}
            </QueryState>
          </Panel>
        </div>
        <Panel
          title="Compare the quiet hours"
          subtitle="Up to three separate nights, aligned by source time of day."
        >
          <QueryState query={profiles}>
            <div className="night-options">
              {profiles.data?.data.daily.map((day) => (
                <label className="check" key={day.date}>
                  <input
                    type="checkbox"
                    checked={nights.includes(day.date)}
                    disabled={nights.length >= 3 && !nights.includes(day.date)}
                    onChange={(e) =>
                      update({
                        nights: (e.target.checked
                          ? [...nights, day.date]
                          : nights.filter((d) => d !== day.date)
                        ).join(","),
                      })
                    }
                  />
                  {day.date}
                  <Badge>{(day.coverage * 100).toFixed(0)}% covered</Badge>
                </label>
              ))}
            </div>
            {nights.length && bins.data ? (
              <NightCompare dates={nights} bins={bins.data.data} />
            ) : (
              <p className="muted">
                Choose nights in the current range to compare their observed
                traces.
              </p>
            )}
          </QueryState>
        </Panel>
        <Panel
          title="Measured circuits & remainder"
          subtitle="Circuit channels cover groups of equipment; remainder is unmetered energy."
        >
          {!dataset?.capabilities.circuits ? (
            <Empty title="Sub-meter channels are unavailable">
              Provide all three sub-meter channels with explicit Wh mappings to
              enable aligned circuit and remainder views.
            </Empty>
          ) : profiles.data?.data.circuits.length ? (
            <div className="circuit-grid">
              {profiles.data.data.circuits.map((circuit) => (
                <div key={circuit.label}>
                  <span>{circuit.label}</span>
                  <strong>{number(circuit.energy_kwh)} kWh</strong>
                  <small>
                    {(circuit.coverage * 100).toFixed(1)}% aligned coverage
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              No circuit aggregates are available for these filters. Synthetic
              illustrations do not provide inferred appliance attribution.
            </p>
          )}
        </Panel>
      </AnalysisGate>
    </>
  );
}

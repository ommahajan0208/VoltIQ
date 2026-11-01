"use client";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import {
  LineChart,
  ScatterChart,
  BarChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  AriaComponent,
  VisualMapComponent,
  CalendarComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { usePreferences } from "./providers";
echarts.use([
  LineChart,
  ScatterChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  AriaComponent,
  VisualMapComponent,
  CalendarComponent,
  SVGRenderer,
]);
export function Chart({
  option,
  label,
  onEvent,
  onRange,
  rangeLabels,
  syncGroup,
}: {
  option: EChartsOption;
  label: string;
  onEvent?: (id: string) => void;
  onRange?: (from: string, to: string) => void;
  rangeLabels?: string[];
  syncGroup?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.EChartsType | null>(null);
  const [zoom, setZoom] = useState(false);
  const { reduce, light } = usePreferences();
  const callback = useRef(onEvent);
  callback.current = onEvent;
  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: "svg" });
    chart.current = instance;
    if (syncGroup) {
      instance.group = syncGroup;
      echarts.connect(syncGroup);
    }
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    instance.on("click", (payload) => {
      const row = payload.data as { event_id?: string } | undefined;
      if (row?.event_id) callback.current?.(row.event_id);
    });
    instance.on("datazoom", () => setZoom(true));
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [syncGroup]);
  useEffect(() => {
    chart.current?.setOption(
      {
        ...option,
        animation: false,
        backgroundColor: "transparent",
        textStyle: {
          fontFamily: "Inter, sans-serif",
          color: light ? "#364d64" : "#A0B2C6",
        },
        aria: { enabled: true, label: { description: label } },
      },
      { notMerge: true },
    );
    setZoom(false);
  }, [option, reduce, light, label]);
  function explore() {
    const current = chart.current?.getOption() as
      | {
          dataZoom?: { start?: number; end?: number }[];
          xAxis?: { data?: string[] }[];
        }
      | undefined;
    const dates = rangeLabels ?? current?.xAxis?.[0]?.data;
    const range = current?.dataZoom?.[0];
    if (dates?.length && range) {
      const a = Math.floor(((range.start ?? 0) / 100) * (dates.length - 1));
      const b = Math.ceil(((range.end ?? 100) / 100) * (dates.length - 1));
      onRange?.(dates[a], dates[b]);
    }
  }
  return (
    <div className="chart-wrap">
      <div className="chart-tools">
        <span>{label}</span>
        <button
          className="text-button"
          onClick={() => {
            chart.current?.dispatchAction({
              type: "dataZoom",
              start: 0,
              end: 100,
            });
            setZoom(false);
          }}
        >
          Reset zoom
        </button>
        {onRange && (
          <button className="text-button" disabled={!zoom} onClick={explore}>
            Explore visible range →
          </button>
        )}
      </div>
      <div ref={host} className="chart" role="img" aria-label={label} />
    </div>
  );
}

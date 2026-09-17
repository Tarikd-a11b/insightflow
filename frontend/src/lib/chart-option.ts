import type { EChartsCoreOption } from "echarts/core";
import { humanize, type ChartSpec } from "./chart-spec";

export type PlotSpec = Exclude<ChartSpec, { kind: "kpi" } | { kind: "table" }>;

/*
 * Modern Canlı & Yüksek Kontrastlı Dataviz Paleti:
 * FinTech & Modern AI standardı (Cyber Indigo, Cyan, Emerald, Amber, Electric Coral, Violet, Azure)
 */
export const PALETTE = {
  light: ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#2563eb"],
  dark: ["#818cf8", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#60a5fa"],
};

/** Grafiğin ekrandan ya da rapordan bağımsız çizilebilmesi için gereken tüm görsel değerler. */
export interface ChartTheme {
  ink: string;
  muted: string;
  grid: string;
  surface: string;
  popover: string;
  palette: string[];
  dataFont: string;
  bodyFont: string;
  interactive: boolean;
}

/** PDF rapor teması: ekran temasından bağımsız, her zaman açık zemin. */
export const PRINT_THEME: ChartTheme = {
  ink: "#0f172a",
  muted: "#64748b",
  grid: "#e2e8f0",
  surface: "#ffffff",
  popover: "#ffffff",
  palette: PALETTE.light,
  dataFont: "IBMPlexSans",
  bodyFont: "IBMPlexSans",
  interactive: false,
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatValue(v: number | null | undefined, percent: boolean, short = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (percent) return pct.format(v);
  return short && Math.abs(v) >= 10_000 ? compact.format(v) : nf.format(v);
}

/** KPI kartında tek sayı var, yer sorunu yok: "26,4 B" yerine 26.403; yalnızca milyonlar kısaltılır. */
export function formatKpi(value: number, percent: boolean): string {
  return formatValue(value, percent, Math.abs(value) >= 1_000_000);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function isMonthly(dates: string[]): boolean {
  return dates.length > 0 && dates.every((d) => d.slice(8, 10) === "01");
}

export function chartHeight(spec: PlotSpec): number {
  if (spec.kind === "bar") return Math.max(180, spec.categories.length * (spec.series.length > 1 ? 36 : 30) + 52);
  if (spec.kind === "donut") return 290;
  return 290;
}

export function buildOption(spec: PlotSpec, t: ChartTheme): EChartsCoreOption {
  const { ink, muted, grid, surface } = t;
  const multi = spec.series.length > 1;

  const axisCommon = {
    axisLine: { lineStyle: { color: grid } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 11, fontFamily: t.dataFont },
    splitLine: { lineStyle: { color: grid, width: 1, type: "dashed" as const } },
  };
  const tooltipBase = {
    show: t.interactive,
    backgroundColor: t.popover,
    borderColor: grid,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: ink, fontSize: 12, fontFamily: t.bodyFont },
    extraCssText: "box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2); border-radius: 10px; backdrop-filter: blur(8px);",
  };
  const base = {
    color: t.palette,
    animation: t.interactive,
    animationDuration: 600,
    aria: { enabled: t.interactive },
    textStyle: { fontFamily: t.bodyFont },
    legend: multi
      ? { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 10, textStyle: { color: muted, fontSize: 12, fontFamily: t.bodyFont } }
      : { show: false },
  };
  const swatch = (color: string) =>
    `<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${color};margin-right:6px"></span>`;

  if (spec.kind === "line") {
    const dates = (spec.series[0]?.data as [string, number | null][]).map(([d]) => d);
    const monthly = isMonthly(dates);
    const dateLabel = (ms: number) => (monthly ? monthFmt : dayFmt).format(new Date(ms));
    
    return {
      ...base,
      grid: { top: multi ? 36 : 14, right: 16, bottom: 28, left: 8, containLabel: true },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.palette[0], width: 1.5, type: "dashed" } },
        formatter: (params: { axisValue: number; color: string; seriesName: string; value: [string, number] }[]) =>
          `<div style="margin-bottom:6px;font-weight:600;color:${muted}">${dateLabel(Number(params[0]?.axisValue))}</div>` +
          params
            .map((p) => `<div style="display:flex;align-items:center;margin:3px 0;">${swatch(p.color)}${multi ? `${esc(p.seriesName)}: ` : ""}<b style="margin-left:auto;padding-left:12px">${formatValue(p.value[1], spec.percent)}</b></div>`)
            .join(""),
      },
      xAxis: { type: "time", ...axisCommon, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => dateLabel(v), hideOverlap: true } },
      yAxis: { type: "value", ...axisCommon, axisLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => formatValue(v, spec.percent, true) } },
      series: spec.series.map((s, idx) => {
        const color = t.palette[idx % t.palette.length];
        return {
          name: s.name,
          type: "line",
          data: (s.data as [string, number | null][]).map(([d, v]) => [`${d.slice(0, 10)}T00:00:00Z`, v]),
          showSymbol: false,
          smooth: 0.25,
          symbolSize: 8,
          lineStyle: { width: 2.8, color },
          itemStyle: { borderColor: surface, borderWidth: 2, color },
          emphasis: { focus: multi ? "series" : "none", scale: true },
          areaStyle: multi ? undefined : {
            opacity: 0.25,
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color },
                { offset: 1, color: "rgba(0,0,0,0)" },
              ],
            },
          },
        };
      }),
    };
  }

  if (spec.kind === "bar") {
    const labelRoom = Math.min(160, Math.max(...spec.categories.map((c) => c.length)) * 7 + 8);
    const labelTips = !multi && spec.categories.length <= 12;
    return {
      ...base,
      grid: { top: multi ? 36 : 6, right: labelTips ? 64 : 16, bottom: 20, left: 8, containLabel: true },
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: { name: string; seriesName: string; value: number; color: string }) =>
          `<div style="margin-bottom:4px;color:${muted}">${esc(p.name)}</div><div>${swatch(p.color)}${multi ? `${esc(p.seriesName)}: ` : ""}<b>${formatValue(p.value, spec.percent)}</b></div>`,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: spec.categories,
        ...axisCommon,
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, fontFamily: t.bodyFont, fontSize: 12, color: ink, width: labelRoom, overflow: "truncate" },
      },
      xAxis: { type: "value", ...axisCommon, axisLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => formatValue(v, spec.percent, true) } },
      series: spec.series.map((s) => ({
        name: s.name,
        type: "bar",
        data: (s.data as number[]).map((val, catIdx) => ({
          value: val,
          itemStyle: multi
            ? { borderRadius: [0, 6, 6, 0] }
            : {
                borderRadius: [0, 6, 6, 0],
                color: t.palette[catIdx % t.palette.length],
              },
        })),
        barMaxWidth: 26,
        barGap: "10%",
        label: labelTips
          ? { show: true, position: "right", color: muted, fontSize: 11, fontFamily: t.dataFont, formatter: (p: { value: number }) => formatValue(p.value, spec.percent, true) }
          : { show: false },
        emphasis: { focus: multi ? "series" : "none" },
      })),
    };
  }

  if (spec.kind === "donut") {
    return {
      ...base,
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number; color: string }) =>
          `<div style="margin-bottom:4px;color:${muted}">${esc(p.name)}</div><div>${swatch(p.color)}<b>${formatValue(p.value, spec.percent)}</b> <span style="color:${muted};margin-left:6px">(${p.percent}%)</span></div>`,
      },
      legend: {
        orient: "horizontal",
        bottom: 6,
        left: "center",
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: muted, fontSize: 11, fontFamily: t.bodyFont },
      },
      series: [
        {
          name: spec.yLabel,
          type: "pie",
          radius: ["44%", "72%"],
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: surface,
            borderWidth: 2,
          },
          label: {
            show: spec.series.length <= 6,
            formatter: "{b}: {d}%",
            fontSize: 11,
            color: muted,
            fontFamily: t.bodyFont,
          },
          emphasis: {
            scale: true,
            scaleSize: 6,
            label: { show: true, fontWeight: "bold", color: ink },
          },
          data: spec.series,
        },
      ],
    };
  }

  return {
    ...base,
    grid: { top: 14, right: 16, bottom: 36, left: 8, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: "item",
      formatter: (p: { value: [number, number] }) =>
        `<div>${esc(humanize(spec.x))}: <b>${nf.format(p.value[0])}</b></div><div>${esc(humanize(spec.y))}: <b>${nf.format(p.value[1])}</b></div>`,
    },
    xAxis: { type: "value", name: humanize(spec.x), nameLocation: "middle", nameGap: 26, nameTextStyle: { color: muted, fontSize: 11, fontFamily: t.bodyFont }, scale: true, ...axisCommon },
    yAxis: { type: "value", name: humanize(spec.y), nameTextStyle: { color: muted, fontSize: 11, align: "left", fontFamily: t.bodyFont }, scale: true, ...axisCommon, axisLine: { show: false } },
    series: spec.series.map((s, idx) => ({
      name: s.name,
      type: "scatter",
      data: s.data,
      symbolSize: t.interactive ? 10 : 6,
      itemStyle: {
        color: t.palette[idx % t.palette.length],
        opacity: 0.85,
        borderColor: surface,
        borderWidth: 1.5,
        shadowBlur: 6,
        shadowColor: t.palette[idx % t.palette.length],
      },
      emphasis: { scale: 1.5, itemStyle: { opacity: 1 } },
    })),
  };
}

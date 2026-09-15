import type { EChartsCoreOption } from "echarts/core";
import { humanize, type ChartSpec } from "./chart-spec";

export type PlotSpec = Exclude<ChartSpec, { kind: "kpi" } | { kind: "table" }>;

/*
 * Kategorik palet: dataviz referans paletinin ilk 4 slotu, bu sırayla (sıra CVD güvenliğinin parçası).
 * validate_palette.js ile uygulamanın kart yüzeylerinde doğrulandı: açık #ffffff, koyu #161c23 (adjacent + all-pairs ilk 3).
 * Açıkta aqua ve sarı 3:1 altında kaldığı için her grafikte tablo görünümü ve eksen/araç ipucu etiketleri var.
 */
export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
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
  /** Rapor gibi statik çıktılarda animasyon ve etkileşim kapatılır. */
  interactive: boolean;
}

/** PDF rapor teması: ekran temasından bağımsız, her zaman açık zemin. */
export const PRINT_THEME: ChartTheme = {
  ink: "#111820",
  muted: "#56616d",
  grid: "#d6dce2",
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

/** Araç ipucu HTML olarak çizilir; hücre değerleri yüklenen dosyadan geldiği için kaçırılmalı. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function isMonthly(dates: string[]): boolean {
  return dates.length > 0 && dates.every((d) => d.slice(8, 10) === "01");
}

export function chartHeight(spec: PlotSpec): number {
  return spec.kind === "bar" ? Math.max(160, spec.categories.length * (spec.series.length > 1 ? 34 : 28) + 48) : 280;
}

export function buildOption(spec: PlotSpec, t: ChartTheme): EChartsCoreOption {
  const { ink, muted, grid, surface } = t;
  const multi = spec.series.length > 1;

  const axisCommon = {
    axisLine: { lineStyle: { color: grid } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 11, fontFamily: t.dataFont },
    splitLine: { lineStyle: { color: grid, width: 1, type: "solid" as const } },
  };
  const tooltipBase = {
    show: t.interactive,
    backgroundColor: t.popover,
    borderColor: grid,
    textStyle: { color: ink, fontSize: 12 },
    extraCssText: "box-shadow: 0 4px 16px rgb(0 0 0 / 0.12); border-radius: 6px;",
  };
  const base = {
    color: t.palette,
    animation: t.interactive,
    animationDuration: 400,
    aria: { enabled: t.interactive },
    textStyle: { fontFamily: t.bodyFont },
    legend: multi
      ? { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: muted, fontSize: 12, fontFamily: t.bodyFont } }
      : { show: false },
  };
  const swatch = (color: string) =>
    `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>`;

  if (spec.kind === "line") {
    const dates = (spec.series[0]?.data as [string, number | null][]).map(([d]) => d);
    const monthly = isMonthly(dates);
    const dateLabel = (ms: number) => (monthly ? monthFmt : dayFmt).format(new Date(ms));
    return {
      ...base,
      grid: { top: multi ? 36 : 12, right: 16, bottom: 28, left: 8, containLabel: true },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: muted, width: 1 } },
        formatter: (params: { axisValue: number; color: string; seriesName: string; value: [string, number] }[]) =>
          `<div style="margin-bottom:4px;color:${muted}">${dateLabel(Number(params[0]?.axisValue))}</div>` +
          params
            .map((p) => `<div>${swatch(p.color)}${multi ? `${esc(p.seriesName)}: ` : ""}<b>${formatValue(p.value[1], spec.percent)}</b></div>`)
            .join(""),
      },
      xAxis: { type: "time", ...axisCommon, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => dateLabel(v), hideOverlap: true } },
      yAxis: { type: "value", ...axisCommon, axisLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => formatValue(v, spec.percent, true) } },
      series: spec.series.map((s) => ({
        name: s.name,
        type: "line",
        data: (s.data as [string, number | null][]).map(([d, v]) => [`${d.slice(0, 10)}T00:00:00Z`, v]),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, cap: "round", join: "round" },
        itemStyle: { borderColor: surface, borderWidth: 2 },
        emphasis: { focus: multi ? "series" : "none", scale: false },
        areaStyle: multi ? undefined : { opacity: 0.1 },
      })),
    };
  }

  if (spec.kind === "bar") {
    // Uzun Türkçe kategori adları için yatay çubuk; kategoriler SQL'in sırasıyla yukarıdan aşağı.
    const labelRoom = Math.min(160, Math.max(...spec.categories.map((c) => c.length)) * 7 + 8);
    const labelTips = !multi && spec.categories.length <= 12;
    return {
      ...base,
      grid: { top: multi ? 36 : 4, right: labelTips ? 64 : 16, bottom: 20, left: 8, containLabel: true },
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
        data: s.data,
        barMaxWidth: 24,
        barGap: "8%",
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: labelTips
          ? { show: true, position: "right", color: muted, fontSize: 11, fontFamily: t.dataFont, formatter: (p: { value: number }) => formatValue(p.value, spec.percent, true) }
          : { show: false },
        emphasis: { focus: multi ? "series" : "none" },
      })),
    };
  }

  return {
    ...base,
    grid: { top: 12, right: 16, bottom: 36, left: 8, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: "item",
      formatter: (p: { value: [number, number] }) =>
        `<div>${esc(humanize(spec.x))}: <b>${nf.format(p.value[0])}</b></div><div>${esc(humanize(spec.y))}: <b>${nf.format(p.value[1])}</b></div>`,
    },
    xAxis: { type: "value", name: humanize(spec.x), nameLocation: "middle", nameGap: 26, nameTextStyle: { color: muted, fontSize: 11, fontFamily: t.bodyFont }, scale: true, ...axisCommon },
    yAxis: { type: "value", name: humanize(spec.y), nameTextStyle: { color: muted, fontSize: 11, align: "left", fontFamily: t.bodyFont }, scale: true, ...axisCommon, axisLine: { show: false } },
    series: spec.series.map((s) => ({
      name: s.name,
      type: "scatter",
      data: s.data,
      symbolSize: t.interactive ? 8 : 5,
      itemStyle: { opacity: 0.7, borderColor: surface, borderWidth: 1 },
      emphasis: { scale: 1.4, itemStyle: { opacity: 1 } },
    })),
  };
}

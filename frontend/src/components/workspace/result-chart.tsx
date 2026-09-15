"use client";

import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { ChartSpec } from "@/lib/chart-spec";
import { humanize } from "@/lib/chart-spec";
import { cn } from "@/lib/utils";

echarts.use([LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

/*
 * Kategorik palet: dataviz referans paletinin ilk 4 slotu, bu sırayla (sıra CVD güvenliğinin parçası).
 * validate_palette.js ile uygulamanın kart yüzeylerinde doğrulandı: açık #ffffff, koyu #161c23 (adjacent + all-pairs ilk 3).
 * Açıkta aqua ve sarı 3:1 altında kaldığı için her grafikte tablo görünümü ve eksen/araç ipucu etiketleri var.
 */
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function formatValue(v: number | null | undefined, percent: boolean, short = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (percent) return pct.format(v);
  return short && Math.abs(v) >= 10_000 ? compact.format(v) : nf.format(v);
}

/** Araç ipucu HTML olarak çizilir; hücre değerleri yüklenen dosyadan geldiği için kaçırılmalı. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function isMonthly(dates: string[]): boolean {
  return dates.length > 0 && dates.every((d) => d.slice(8, 10) === "01");
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildOption(spec: Exclude<ChartSpec, { kind: "kpi" } | { kind: "table" }>, dark: boolean): echarts.EChartsCoreOption {
  const ink = cssVar("--foreground");
  const muted = cssVar("--muted-foreground");
  const grid = cssVar("--border");
  const surface = cssVar("--card");
  const colors = dark ? PALETTE.dark : PALETTE.light;
  // SVG öznitelikleri var() çözmez; next/font'un ürettiği gerçek aile adını oku.
  const dataFont = cssVar("--font-data") || "monospace";
  const bodyFont = cssVar("--font-body") || "sans-serif";
  const multi = spec.series.length > 1;

  const axisCommon = {
    axisLine: { lineStyle: { color: grid } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 11, fontFamily: dataFont },
    splitLine: { lineStyle: { color: grid, width: 1, type: "solid" as const } },
  };
  const tooltipBase = {
    backgroundColor: cssVar("--popover"),
    borderColor: grid,
    textStyle: { color: ink, fontSize: 12 },
    extraCssText: "box-shadow: 0 4px 16px rgb(0 0 0 / 0.12); border-radius: 6px;",
  };
  const base = {
    color: colors,
    animationDuration: 400,
    aria: { enabled: true },
    textStyle: { fontFamily: bodyFont },
    legend: multi
      ? { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: muted, fontSize: 12 } }
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
        formatter: (params: { axisValue: number; marker: string; color: string; seriesName: string; value: [string, number] }[]) =>
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
        axisLabel: { ...axisCommon.axisLabel, fontFamily: bodyFont, fontSize: 12, color: ink, width: labelRoom, overflow: "truncate" },
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
          ? { show: true, position: "right", color: muted, fontSize: 11, fontFamily: dataFont, formatter: (p: { value: number }) => formatValue(p.value, spec.percent, true) }
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
    xAxis: { type: "value", name: humanize(spec.x), nameLocation: "middle", nameGap: 26, nameTextStyle: { color: muted, fontSize: 11 }, scale: true, ...axisCommon },
    yAxis: { type: "value", name: humanize(spec.y), nameTextStyle: { color: muted, fontSize: 11, align: "left" }, scale: true, ...axisCommon, axisLine: { show: false } },
    series: spec.series.map((s) => ({
      name: s.name,
      type: "scatter",
      data: s.data,
      symbolSize: 8,
      itemStyle: { opacity: 0.7, borderColor: surface, borderWidth: 1 },
      emphasis: { scale: 1.4, itemStyle: { opacity: 1 } },
    })),
  };
}

export function ResultChart({
  spec,
  className,
  height: fixedHeight,
}: {
  spec: Exclude<ChartSpec, { kind: "kpi" } | { kind: "table" }>;
  className?: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, null, { renderer: "svg", locale: "EN" });
    const render = () => chart.setOption(buildOption(spec, document.documentElement.classList.contains("dark")), true);
    render();

    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(el);
    // Tema değişince renkler CSS değişkenlerinden yeniden okunur (koyu mod otomatik çevirme değil, seçilmiş adımlar).
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [spec]);

  const height = fixedHeight ?? (spec.kind === "bar" ? Math.max(160, spec.categories.length * (spec.series.length > 1 ? 34 : 28) + 48) : 280);
  return <div ref={ref} data-chart={spec.kind} className={cn("w-full", className)} style={{ height }} />;
}

export function KpiTiles({ items }: { items: Extract<ChartSpec, { kind: "kpi" }>["items"] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-2xl font-semibold tracking-tight">
            {typeof item.value === "number"
              ? // Kartta tek sayı var, yer sorunu yok: "26,4 B" yerine 26.403; yalnızca milyonlar kısaltılır.
                formatValue(item.value, item.percent, Math.abs(item.value) >= 1_000_000)
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

"use client";

import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { buildOption, chartHeight, formatKpi, PALETTE, type ChartTheme, type PlotSpec } from "@/lib/chart-option";
import type { ChartSpec } from "@/lib/chart-spec";
import { cn } from "@/lib/utils";

echarts.use([LineChart, BarChart, PieChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Ekran teması CSS değişkenlerinden okunur (koyu mod otomatik çevirme değil, seçilmiş adımlar). */
function screenTheme(): ChartTheme {
  const dark = document.documentElement.classList.contains("dark");
  return {
    ink: cssVar("--foreground"),
    muted: cssVar("--muted-foreground"),
    grid: cssVar("--border"),
    surface: cssVar("--card"),
    popover: cssVar("--popover"),
    palette: dark ? PALETTE.dark : PALETTE.light,
    // SVG öznitelikleri var() çözmez; next/font'un ürettiği gerçek aile adını oku.
    dataFont: cssVar("--font-data") || "monospace",
    bodyFont: cssVar("--font-body") || "sans-serif",
    interactive: true,
  };
}

export function ResultChart({ spec, className, height: fixedHeight }: { spec: PlotSpec; className?: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, null, { renderer: "svg", locale: "EN" });
    const render = () => chart.setOption(buildOption(spec, screenTheme()), true);
    render();

    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(el);
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [spec]);

  return <div ref={ref} data-chart={spec.kind} className={cn("w-full", className)} style={{ height: fixedHeight ?? chartHeight(spec) }} />;
}

export function KpiTiles({ items }: { items: Extract<ChartSpec, { kind: "kpi" }>["items"] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-2xl font-semibold tracking-tight">
            {typeof item.value === "number" ? formatKpi(item.value, item.percent) : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

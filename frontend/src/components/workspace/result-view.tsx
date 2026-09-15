"use client";

import { useMemo } from "react";
import type { ChartKind } from "@/lib/api";
import { buildChartSpec } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/data/types";
import { PreviewTable } from "./preview-table";
import { KpiTiles, ResultChart } from "./result-chart";

/** Bir sonucu grafik, KPI kartları veya tablo olarak gösterir. Yanıt kartı ve pano ortak kullanır. */
export function ResultView({
  result,
  chart,
  mode = "auto",
  chartHeight,
  tableClassName = "max-h-80",
}: {
  result: QueryResult;
  chart: ChartKind;
  mode?: "auto" | "table";
  chartHeight?: number;
  tableClassName?: string;
}) {
  const spec = useMemo(() => buildChartSpec(chart, result), [chart, result]);

  if (mode === "table" || spec.kind === "table") return <PreviewTable result={result} className={tableClassName} />;
  if (spec.kind === "kpi") return <KpiTiles items={spec.items} />;
  return (
    <div className="rounded-lg border bg-card p-3">
      <ResultChart spec={spec} height={chartHeight} />
    </div>
  );
}

export function hasChart(chart: ChartKind, result: QueryResult): boolean {
  return buildChartSpec(chart, result).kind !== "table";
}

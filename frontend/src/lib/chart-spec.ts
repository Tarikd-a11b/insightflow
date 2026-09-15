import type { ChartKind } from "./api";
import type { QueryResult } from "./data/types";

/**
 * Sonuç tablosundan grafik tanımı çıkarır. Modelin önerdiği tür (`hint`) bir ipucudur; sonucun şekli
 * o türe uymuyorsa şekle en uygun tür seçilir, hiçbiri uymuyorsa tablo gösterilir.
 */

export const MAX_SERIES = 4; // Paletin ilk 4 rengi doğrulandı; fazlası "Diğer"e katlanır.
const MAX_BAR_ROWS = 30;
const OTHER = "Diğer";

export type ColumnRole = "time" | "number" | "category";

export interface Series {
  name: string;
  /** line: [isoTarih, değer], bar: kategori sırasına göre değer, scatter: [x, y] */
  data: (number | null)[] | [string, number | null][] | [number, number][];
}

export type ChartSpec =
  | { kind: "line"; x: string; series: Series[]; percent: boolean; yLabel: string }
  | { kind: "bar"; x: string; categories: string[]; series: Series[]; percent: boolean; yLabel: string }
  | { kind: "scatter"; x: string; y: string; series: Series[] }
  | { kind: "kpi"; items: { label: string; value: number | string; percent: boolean }[] }
  | { kind: "table" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
const RATE_NAME = /(oran|orani|oranı|rate|ratio|yuzde|yüzde|pay|share|percent)/i;

export function columnRoles(result: QueryResult): Record<string, ColumnRole> {
  const roles: Record<string, ColumnRole> = {};
  for (const col of result.columns) {
    const values = result.rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
    if (values.length > 0 && values.every((v) => typeof v === "number")) roles[col] = "number";
    else if (values.length > 0 && values.every((v) => typeof v === "string" && ISO_DATE.test(v))) roles[col] = "time";
    else roles[col] = "category";
  }
  return roles;
}

/** 0-1 aralığında ve adı oran gibi olan sütunlar yüzde olarak gösterilir. */
export function isRate(result: QueryResult, col: string): boolean {
  if (!RATE_NAME.test(col)) return false;
  return result.rows.every((r) => r[col] === null || (typeof r[col] === "number" && (r[col] as number) >= 0 && (r[col] as number) <= 1));
}

export function humanize(col: string): string {
  const s = col.replace(/_/g, " ").trim();
  return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function kpi(result: QueryResult, numbers: string[]): ChartSpec | null {
  if (result.rows.length !== 1 || numbers.length === 0 || numbers.length > 6) return null;
  const row = result.rows[0];
  return {
    kind: "kpi",
    items: result.columns.map((c) => ({
      label: humanize(c),
      value: typeof row[c] === "number" ? (row[c] as number) : String(row[c] ?? "—"),
      percent: numbers.includes(c) && isRate(result, c),
    })),
  };
}

function line(result: QueryResult, times: string[], numbers: string[], cats: string[]): ChartSpec | null {
  if (times.length !== 1 || numbers.length === 0 || result.rows.length < 2) return null;
  const x = times[0];

  // Uzun biçim (ay, kategori, değer): kategoriyi seriye çevir, en büyük 3 dışındakileri "Diğer"e topla.
  if (cats.length === 1 && numbers.length === 1) {
    const [cat] = cats;
    const [value] = numbers;
    const totals = new Map<string, number>();
    for (const r of result.rows) totals.set(String(r[cat]), (totals.get(String(r[cat])) ?? 0) + (num(r[value]) ?? 0));
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const keep = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
    const rate = isRate(result, value);

    const buckets = new Map<string, Map<string, number>>();
    for (const r of result.rows) {
      const name = keep.includes(String(r[cat])) ? String(r[cat]) : OTHER;
      const bucket = buckets.get(name) ?? new Map<string, number>();
      const t = String(r[x]);
      // Oranlar toplanamaz; "Diğer" yalnızca toplanabilir değerlerde oluşturulur.
      if (name === OTHER && rate) continue;
      bucket.set(t, (bucket.get(t) ?? 0) + (num(r[value]) ?? 0));
      buckets.set(name, bucket);
    }
    const order = [...keep, ...(buckets.has(OTHER) ? [OTHER] : [])];
    return {
      kind: "line",
      x,
      percent: rate,
      yLabel: humanize(value),
      series: order.map((name) => ({
        name,
        data: [...(buckets.get(name) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)),
      })),
    };
  }

  if (cats.length > 0) return null;
  const sorted = [...result.rows].sort((a, b) => String(a[x]).localeCompare(String(b[x])));
  const shown = numbers.slice(0, MAX_SERIES);
  return {
    kind: "line",
    x,
    percent: shown.every((c) => isRate(result, c)),
    yLabel: shown.length === 1 ? humanize(shown[0]) : "",
    series: shown.map((c) => ({ name: humanize(c), data: sorted.map((r) => [String(r[x]), num(r[c])] as [string, number | null]) })),
  };
}

function bar(result: QueryResult, times: string[], numbers: string[], cats: string[]): ChartSpec | null {
  const labelCols = [...cats, ...times];
  if (labelCols.length !== 1 || numbers.length === 0 || result.rows.length < 1 || result.rows.length > MAX_BAR_ROWS) return null;
  const [x] = labelCols;
  const shown = numbers.slice(0, MAX_SERIES);
  // Farklı birimdeki ölçüler tek eksende yanıltır (ör. adet ile tutar); bu durumda yalnızca ilk ölçü çizilir.
  const rates = shown.map((c) => isRate(result, c));
  const sameUnit = rates.every((r) => r === rates[0]) && sameMagnitude(result, shown);
  const plotted = sameUnit ? shown : shown.slice(0, 1);
  return {
    kind: "bar",
    x,
    categories: result.rows.map((r) => String(r[x] ?? "—")),
    percent: isRate(result, plotted[0]),
    yLabel: plotted.length === 1 ? humanize(plotted[0]) : "",
    series: plotted.map((c) => ({ name: humanize(c), data: result.rows.map((r) => num(r[c])) })),
  };
}

function sameMagnitude(result: QueryResult, cols: string[]): boolean {
  if (cols.length < 2) return true;
  const maxes = cols.map((c) => Math.max(...result.rows.map((r) => Math.abs(num(r[c]) ?? 0))));
  const lo = Math.min(...maxes);
  const hi = Math.max(...maxes);
  return lo > 0 && hi / lo <= 10;
}

function scatter(result: QueryResult, numbers: string[]): ChartSpec | null {
  if (numbers.length < 2 || result.rows.length < 3) return null;
  const [x, y] = numbers;
  const points = result.rows
    .map((r) => [num(r[x]), num(r[y])])
    .filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
  return { kind: "scatter", x, y, series: [{ name: `${humanize(x)} – ${humanize(y)}`, data: points }] };
}

export function buildChartSpec(hint: ChartKind, result: QueryResult): ChartSpec {
  if (result.rows.length === 0) return { kind: "table" };
  const roles = columnRoles(result);
  const of = (role: ColumnRole) => result.columns.filter((c) => roles[c] === role);
  const numbers = of("number");
  const times = of("time");
  const cats = of("category");

  const builders: Record<Exclude<ChartKind, "table">, () => ChartSpec | null> = {
    kpi: () => kpi(result, numbers),
    line: () => line(result, times, numbers, cats),
    bar: () => bar(result, times, numbers, cats),
    scatter: () => scatter(result, numbers),
  };

  if (hint !== "table") {
    const fromHint = builders[hint]();
    if (fromHint) return fromHint;
  }
  // İpucu uymadıysa şekle göre en uygun tür.
  for (const kind of ["kpi", "line", "bar", "scatter"] as const) {
    const spec = builders[kind]();
    if (spec) return spec;
  }
  return { kind: "table" };
}

/**
 * "Neden değişti?": bir zaman serisinde iki dönem arasındaki farkı kategorilere böler (katkı analizi).
 *
 * Yanıtın SQL'i DuckDB'nin kendi ayrıştırıcısıyla (json_serialize_sql) ağaca çevrilir; aynı sorgu, aynı FROM/JOIN ve
 * WHERE ile, bu kez bir kategorik sütuna göre de gruplanarak yeniden kurulur (json_deserialize_sql). Her şey tarayıcıdaki
 * kilitli motorda çalışır, model çağrısı yoktur. Kırılımların toplamı orijinal sonuçla tutmazsa analiz gösterilmez.
 */

import { columnRoles, humanize } from "./chart-spec";
import type { ColumnProfile, QueryResult, TableProfile } from "./data/types";

export interface WhyRunner {
  query(sql: string): Promise<QueryResult>;
  /** json_serialize_sql çıktısı. */
  parseSql(sql: string): Promise<unknown>;
  /** json_deserialize_sql: ağacı yeniden SQL'e çevirir. */
  renderSql(ast: unknown): Promise<string>;
}

/** Sonuç bir zaman serisi mi; öyleyse zaman sütunu ve aday ölçüler. */
export interface WhyTarget {
  timeCol: string;
  valueCols: string[];
  periods: string[];
}

export function whyTarget(result: QueryResult): WhyTarget | null {
  if (result.rows.length < 2) return null;
  const roles = columnRoles(result);
  const times = result.columns.filter((c) => roles[c] === "time");
  const numbers = result.columns.filter((c) => roles[c] === "number");
  const cats = result.columns.filter((c) => roles[c] === "category");
  if (times.length !== 1 || numbers.length === 0 || cats.length > 0) return null;
  const [timeCol] = times;
  const periods = result.rows.map((r) => String(r[timeCol])).sort();
  // Her dönem tek satır olmalı (uzun biçimli sonuç değil).
  if (new Set(periods).size !== periods.length) return null;
  return { timeCol, valueCols: numbers, periods };
}

/* ---------- Sorgu ağacı ---------- */

type Node = Record<string, unknown>;

export interface Dimension {
  /** Tabloda görünen ad (ör. "sehir" ya da JOIN'de "musteriler.sehir"). */
  label: string;
  /** Kırılım SQL'inde kullanılacak nitelikli sütun başvurusu. */
  ref: [string, string];
}

export type BreakdownPlan =
  | { ok: true; dims: Dimension[]; build: (dim: Dimension) => Node }
  | { ok: false; reason: string };

const ADDITIVE = new Set(["sum", "count", "count_star"]);
export const DIM_KEY = "__boyut";
const MAX_DIMS = 6;
const MULTI_STEP = "Bu sorgu birden fazla adımdan (alt sorgu, CTE ya da birleşik sorgu) oluştuğu için kırılım yapılamıyor.";

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Toplanabilir toplama fonksiyonunu döndürür; ROUND(SUM(x), 2) gibi bir sarmalayıcı varsa içini açar. */
function additiveAggregate(expr: Node): Node | null {
  if (expr.class !== "FUNCTION") return null;
  const name = String(expr.function_name).toLowerCase();
  if (ADDITIVE.has(name)) return expr.distinct ? null : expr;
  const children = Array.isArray(expr.children) ? (expr.children as Node[]) : [];
  if (name === "round" && children.length >= 1 && isNode(children[0])) return additiveAggregate(children[0]);
  return null;
}

/** FROM ağacındaki temel tablolar (takma adlarıyla). JOIN dışında bir şey varsa null. */
function baseTables(from: unknown): { name: string; alias: string }[] | null {
  if (!isNode(from)) return null;
  if (from.type === "BASE_TABLE") return [{ name: String(from.table_name), alias: String(from.alias || from.table_name) }];
  if (from.type === "JOIN") {
    const l = baseTables(from.left);
    const r = baseTables(from.right);
    return l && r ? [...l, ...r] : null;
  }
  return null;
}

const usableDim = (c: ColumnProfile) => c.categorical && !c.identifier && c.distinct >= 2;

/**
 * Sorgu ağacını kırılıma uygunluk açısından denetler. Uygunsa, verilen boyut için
 * `SELECT <zaman>, <boyut> AS __boyut, <ölçü> FROM ... WHERE ... GROUP BY <zaman>, <boyut>` ağacını kuran bir fonksiyon döner.
 */
export function planBreakdown(parsed: unknown, timeCol: string, valueCol: string, tables: TableProfile[]): BreakdownPlan {
  if (!isNode(parsed) || parsed.error) return { ok: false, reason: "Sorgu çözümlenemedi." };
  const statements = parsed.statements as { node: Node }[] | undefined;
  if (!statements || statements.length !== 1) return { ok: false, reason: MULTI_STEP };
  const node = statements[0].node;
  if (node.type !== "SELECT_NODE") return { ok: false, reason: MULTI_STEP };
  const cteMap = (node.cte_map as { map?: unknown[] } | undefined)?.map ?? [];
  if (cteMap.length > 0) return { ok: false, reason: MULTI_STEP };

  const modifiers = (node.modifiers as Node[] | undefined) ?? [];
  if (modifiers.some((m) => m.type === "DISTINCT_MODIFIER") || node.having || node.qualify || node.sample) {
    return { ok: false, reason: "Sorgu DISTINCT, HAVING ya da örnekleme içerdiği için kırılım sonucu orijinalle tutarlı olmaz." };
  }

  const from = baseTables(node.from_table);
  if (!from) return { ok: false, reason: MULTI_STEP };

  const select = (node.select_list as Node[] | undefined) ?? [];
  const timeExpr = select.find((e) => e.alias === timeCol);
  const valueExpr = select.find((e) => e.alias === valueCol);
  if (!timeExpr || !valueExpr) return { ok: false, reason: "Zaman ya da ölçü sütununun sorgudaki karşılığı bulunamadı." };
  const aggregate = additiveAggregate(valueExpr);
  if (!aggregate) {
    return {
      ok: false,
      reason: `"${humanize(valueCol)}" toplanabilir bir ölçü değil (ortalama, oran ya da benzersiz sayım). Böyle bir değerin değişimi kategorilere paylaştırılamaz; toplam ya da adet soran bir soruda deneyin.`,
    };
  }

  const dims: Dimension[] = [];
  const multi = from.length > 1;
  for (const t of from) {
    const profile = tables.find((p) => p.table === t.name);
    if (!profile) return { ok: false, reason: MULTI_STEP };
    for (const col of profile.columns.filter(usableDim)) {
      dims.push({ label: multi ? `${t.name}.${col.name}` : col.name, ref: [t.alias, col.name] });
    }
  }
  if (dims.length === 0) return { ok: false, reason: "Veride kırılım yapılabilecek kategorik bir sütun yok." };
  // Az değerli kırılımlar daha okunur; çok değerliler sona.
  const distinctOf = (d: Dimension) =>
    from.flatMap((t) => tables.find((p) => p.table === t.name)?.columns ?? []).find((c) => c.name === d.ref[1])?.distinct ?? 0;
  dims.sort((a, b) => distinctOf(a) - distinctOf(b));

  const build = (dim: Dimension): Node => {
    const tree = clone(parsed) as { statements: { node: Node }[] };
    const n = tree.statements[0].node;
    const time = { ...clone(timeExpr), alias: timeCol };
    const value = { ...clone(aggregate), alias: valueCol };
    const colRef = { class: "COLUMN_REF", type: "COLUMN_REF", alias: DIM_KEY, query_location: 0, column_names: dim.ref };
    n.select_list = [time, colRef, value];
    n.group_expressions = [{ ...clone(timeExpr), alias: "" }, { ...colRef, alias: "" }];
    n.group_sets = [[0, 1]];
    n.aggregate_handling = "STANDARD_HANDLING";
    n.modifiers = [];
    return tree as unknown as Node;
  };

  return { ok: true, dims: dims.slice(0, MAX_DIMS), build };
}

/* ---------- Katkı hesabı ---------- */

export interface Segment {
  key: string;
  before: number;
  after: number;
  delta: number;
}

export interface DimBreakdown {
  dim: string;
  segments: Segment[];
  /** Değişim yönündeki en büyük katkının toplam değişime oranı. */
  topShare: number;
}

export function decompose(
  rows: Record<string, unknown>[],
  timeCol: string,
  valueCol: string,
  from: string,
  to: string,
): Segment[] {
  const map = new Map<string, Segment>();
  for (const r of rows) {
    const t = String(r[timeCol]);
    if (t !== from && t !== to) continue;
    const key = r[DIM_KEY] === null || r[DIM_KEY] === undefined ? "(boş)" : String(r[DIM_KEY]);
    const v = typeof r[valueCol] === "number" ? (r[valueCol] as number) : 0;
    const seg = map.get(key) ?? { key, before: 0, after: 0, delta: 0 };
    if (t === from) seg.before += v;
    else seg.after += v;
    seg.delta = seg.after - seg.before;
    map.set(key, seg);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function rankBreakdown(dim: string, segments: Segment[]): DimBreakdown {
  const total = segments.reduce((a, s) => a + s.delta, 0);
  const sign = Math.sign(total) || 1;
  const top = Math.max(0, ...segments.map((s) => s.delta * sign));
  return { dim, segments, topShare: total === 0 ? 0 : top / Math.abs(total) };
}

/** Kırılım toplamı sonuçtaki değerle tutuyor mu (yuvarlama payı ile). */
export function reconciles(segments: Segment[], before: number, after: number): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.005);
  return close(segments.reduce((a, s) => a + s.before, 0), before) && close(segments.reduce((a, s) => a + s.after, 0), after);
}

/* ---------- Anlatım ---------- */

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const share = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 0 });
const monthFmt = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const fmtNum = (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : nf.format(v));
export const fmtDelta = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtNum(Math.abs(v));
export const fmtChange = (before: number, after: number) => (before === 0 ? "yeni" : pct.format((after - before) / Math.abs(before)));

/** Ay başı tarihleri ay adıyla, diğerlerini gün ile yazar. */
export function periodLabel(iso: string, periods: string[]): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const monthly = periods.every((p) => p.slice(8, 10) === "01");
  return (monthly ? monthFmt : dayFmt).format(d);
}

export interface WhyStory {
  headline: string;
  details: string[];
}

export function describeWhy(
  metric: string,
  fromLabel: string,
  toLabel: string,
  before: number,
  after: number,
  best: DimBreakdown | null,
): WhyStory {
  const total = after - before;
  const head = `${humanize(metric)}, ${fromLabel} → ${toLabel} arasında ${fmtNum(before)} → ${fmtNum(after)} (${fmtChange(before, after)}).`;
  if (total === 0 || !best) return { headline: `${head} İki dönem arasında net bir değişim yok.`, details: [] };

  const direction = total > 0 ? "artışın" : "düşüşün";
  const sign = Math.sign(total);
  const drivers = best.segments.filter((s) => s.delta * sign > 0);
  const [top] = drivers;
  const details: string[] = [];

  if (best.topShare < 0.4) {
    details.push(`Değişim tek bir ${humanize(best.dim).toLocaleLowerCase("tr-TR")} değerinde yoğunlaşmıyor; ${drivers.length} farklı değere yayılmış.`);
  } else {
    // Sayıya gelen ek ses uyumuyla değişir (%62'si / %70'i); ek gerektirmeyen kalıp kullanılır.
    details.push(
      `En büyük etken ${humanize(best.dim)} → ${top.key}: ${direction} ${share.format(Math.min(best.topShare, 1))} kadarı (${fmtNum(top.before)} → ${fmtNum(top.after)}, ${fmtChange(top.before, top.after)}).`,
    );
    const second = drivers[1];
    if (second && (second.delta * sign) / Math.abs(total) >= 0.15) {
      details.push(`Onu ${second.key} izliyor (${fmtDelta(second.delta)}).`);
    }
  }
  const counter = best.segments.find((s) => s.delta * sign < 0 && Math.abs(s.delta) / Math.abs(total) >= 0.1);
  if (counter) details.push(`Buna karşın ${counter.key} ters yönde ${fmtDelta(counter.delta)} değişti.`);
  return { headline: head, details };
}

/* ---------- Çalıştırma ---------- */

export type WhyOutcome =
  | {
      ok: true;
      story: WhyStory;
      breakdowns: DimBreakdown[];
      before: number;
      after: number;
      ms: number;
    }
  | { ok: false; reason: string };

export async function explainChange(
  runner: WhyRunner,
  args: { sql: string; result: QueryResult; timeCol: string; valueCol: string; from: string; to: string; tables: TableProfile[] },
): Promise<WhyOutcome> {
  const started = performance.now();
  const { result, timeCol, valueCol, from, to } = args;
  const valueAt = (p: string) => {
    const v = result.rows.find((r) => String(r[timeCol]) === p)?.[valueCol];
    return typeof v === "number" ? v : null;
  };
  const before = valueAt(from);
  const after = valueAt(to);
  if (before === null || after === null) return { ok: false, reason: "Seçilen dönemlerden birinde değer yok." };

  let parsed: unknown;
  try {
    parsed = await runner.parseSql(args.sql);
  } catch {
    return { ok: false, reason: "Sorgu çözümlenemedi." };
  }
  const plan = planBreakdown(parsed, timeCol, valueCol, args.tables);
  if (!plan.ok) return plan;

  const breakdowns: DimBreakdown[] = [];
  for (const dim of plan.dims) {
    let rows: Record<string, unknown>[];
    try {
      rows = (await runner.query(await runner.renderSql(plan.build(dim)))).rows;
    } catch {
      continue; // Bu boyut kurulamadıysa (ör. beklenmeyen tip) diğerleriyle devam.
    }
    const segments = decompose(rows, timeCol, valueCol, from, to);
    if (segments.length < 2) continue;
    // Kırılım orijinal sonuçla tutmuyorsa sorgu yapısı beklenenden farklıdır; yanlış bir hikâye anlatmaktansa vazgeç.
    if (!reconciles(segments, before, after)) {
      return { ok: false, reason: "Kırılım toplamı orijinal sonuçla doğrulanamadı; bu sorgu için analiz güvenilir olmaz." };
    }
    breakdowns.push(rankBreakdown(dim.label, segments));
  }
  if (breakdowns.length === 0) return { ok: false, reason: "Bu dönemlerde birden fazla değeri olan bir kırılım bulunamadı." };

  breakdowns.sort((a, b) => b.topShare - a.topShare);
  const label = (p: string) => periodLabel(p, result.rows.map((r) => String(r[timeCol])));
  const story = describeWhy(valueCol, label(from), label(to), before, after, after === before ? null : breakdowns[0]);
  return { ok: true, story, breakdowns, before, after, ms: Math.round(performance.now() - started) };
}

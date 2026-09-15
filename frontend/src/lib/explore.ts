/**
 * "Veriyi keşfet": veri seti yüklenince kullanıcı soru düşünmeden hazır içgörüler üretir.
 * Tamamen tarayıcıda çalışır ve hiç model çağrısı yapmaz: sorgular DuckDB-WASM'da koşar, cümleler
 * sonuçlardan kural tabanlı ve basit istatistikle (ortalama, standart sapma, korelasyon) kurulur.
 */

import type { ChartKind } from "./api";
import { rankColumns } from "./data/questions";
import { quoteIdent } from "./data/profile";
import type { ColumnProfile, DatasetProfile, QueryResult } from "./data/types";

export interface InsightPlan {
  id: "trend" | "share" | "rate" | "correlation" | "quality";
  title: string;
  sql: string;
  chart: ChartKind;
  /** İstatistik için ek, tek satırlık sorgu (ör. tam veri üzerinde korelasyon). */
  statsSql?: string;
  /** Sonuçtan tek-iki cümlelik başlık üretir; anlamlı bir bulgu yoksa null (içgörü atlanır). */
  describe: (result: QueryResult, stats?: Record<string, unknown>) => string | null;
}

export interface Insight {
  id: InsightPlan["id"];
  title: string;
  headline: string;
  sql: string;
  chart: ChartKind;
  result: QueryResult;
  ms: number;
}

const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });

const fmt = (v: number) => (Math.abs(v) >= 100_000 ? compact.format(v) : num.format(v));
const monthLabel = (iso: string) => monthFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const toNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const q = quoteIdent;
/** "toplam toplam_tutar" tekrarını önler. */
const totalLabel = (name: string) => (/(toplam|total|sum)/i.test(name) ? name : `toplam ${name}`);

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function describeTrend(result: QueryResult, valueCol: string, label: string): string | null {
  const points = result.rows
    .map((r) => ({ month: String(r.ay ?? ""), value: toNum(r[valueCol]) }))
    .filter((p): p is { month: string; value: number } => p.month !== "" && p.value !== null);
  if (points.length < 3) return null;

  const values = points.map((p) => p.value);
  const avg = mean(values);
  const sd = stdev(values);
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
  const sentences: string[] = [];

  const aboveAvg = avg !== 0 ? (peak.value - avg) / Math.abs(avg) : 0;
  sentences.push(`En yüksek ay ${monthLabel(peak.month)} (${fmt(peak.value)}; aylık ortalamanın ${pct.format(aboveAvg)} üstünde).`);

  // Olağan dışı düşük ay: ortalamadan 2 standart sapmadan fazla aşağıda.
  const low = points.reduce((a, b) => (b.value < a.value ? b : a));
  if (sd > 0 && (avg - low.value) / sd >= 2) {
    sentences.push(`${monthLabel(low.month)} olağan dışı düşük kaldı (${fmt(low.value)}).`);
  } else if (points.length >= 6) {
    const last3 = mean(values.slice(-3));
    const prev3 = mean(values.slice(-6, -3));
    if (prev3 !== 0) {
      const change = (last3 - prev3) / Math.abs(prev3);
      const direction = Math.abs(change) < 0.02 ? "yatay seyretti" : change > 0 ? `${pct.format(change)} arttı` : `${pct.format(-change)} azaldı`;
      sentences.push(`Son 3 ayda ${label} önceki 3 aya göre ${direction}.`);
    }
  }
  return sentences.join(" ");
}

export function describeShare(result: QueryResult, dimCol: string, label: string): string | null {
  const rows = result.rows.map((r) => ({ key: String(r[dimCol] ?? "—"), share: toNum(r.pay) })).filter((r) => r.share !== null) as { key: string; share: number }[];
  if (rows.length < 2) return null;
  const top3 = rows.slice(0, 3).reduce((a, r) => a + r.share, 0);
  const first = `${rows[0].key}, ${label} içinde ${pct.format(rows[0].share)} payla ilk sırada.`;
  // Sayıya gelen Türkçe ek ses uyumuna göre değişir (%70,8'ini / %73,6'sını); ek gerektirmeyen kalıp kullanılır.
  return rows.length > 3 ? `${first} İlk 3 ${dimCol}, toplamın ${pct.format(top3)} kadarını oluşturuyor.` : first;
}

export function describeRate(result: QueryResult, dimCol: string, rateCol: string, flagName: string): string | null {
  const rows = result.rows
    .map((r) => ({ key: String(r[dimCol] ?? "—"), rate: toNum(r[rateCol]), n: toNum(r.kayit) }))
    .filter((r): r is { key: string; rate: number; n: number } => r.rate !== null && r.n !== null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b.rate - a.rate);
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  if (hi.rate - lo.rate < 0.01) return null;
  const overall = rows.reduce((a, r) => a + r.rate * r.n, 0) / rows.reduce((a, r) => a + r.n, 0);
  return `${flagName} oranı en yüksek ${hi.key} (${pct.format(hi.rate)}), en düşük ${lo.key} (${pct.format(lo.rate)}); genel oran ${pct.format(overall)}.`;
}

export function describeCorrelation(r: number | null, a: string, b: string): string | null {
  if (r === null || Number.isNaN(r)) return null;
  const abs = Math.abs(r);
  const rText = `r = ${num.format(Math.round(r * 100) / 100)}`;
  if (abs < 0.2) return `${a} ile ${b} arasında belirgin bir doğrusal ilişki yok (${rText}).`;
  const strength = abs >= 0.7 ? "güçlü" : abs >= 0.4 ? "orta düzeyde" : "zayıf";
  return `${a} ile ${b} arasında ${strength} ${r > 0 ? "pozitif" : "negatif"} ilişki var (${rText}).`;
}

export function describeQuality(result: QueryResult, columns: ColumnProfile[]): string | null {
  const row = result.rows[0];
  const total = toNum(row?.kayit);
  const dup = toNum(row?.tekrar_eden_kayit);
  if (total === null || dup === null) return null;
  const sparse = columns.filter((c) => c.nullPercent > 5);
  const dupText = dup === 0 ? "Birebir tekrar eden kayıt yok" : `${num.format(total)} kaydın ${num.format(dup)} tanesi birebir tekrar ediyor`;
  const nullText =
    sparse.length === 0
      ? "hiçbir sütunda %5'ten fazla boş değer yok."
      : `${sparse.length} sütunda %5'ten fazla boş değer var (${sparse
          .slice(0, 3)
          .map((c) => `${c.name} %${Math.round(c.nullPercent)}`)
          .join(", ")}${sparse.length > 3 ? "…" : ""}).`;
  return `${dupText}; ${nullText}`;
}

/** Profile göre çalıştırılabilecek içgörüleri seçer. Hepsi yalnızca `data` tablosunu okuyan, kendi yazdığımız SQL'lerdir. */
export function planInsights(profile: DatasetProfile): InsightPlan[] {
  const { measures, dates, flags, dims } = rankColumns(profile.columns);
  const [m1, m2] = measures;
  const [t1] = dates;
  const [d1, d2] = dims;
  const [f1] = flags;
  const plans: InsightPlan[] = [];

  if (t1) {
    const value = m1 ? m1.name : "kayit_sayisi";
    const agg = m1 ? `SUM(${q(m1.name)})` : "COUNT(*)";
    plans.push({
      id: "trend",
      title: m1 ? `Aylık ${m1.name} trendi` : "Aylık kayıt sayısı",
      chart: "line",
      sql: `SELECT date_trunc('month', ${q(t1.name)}) AS ay, ${agg} AS ${q(value)} FROM data WHERE ${q(t1.name)} IS NOT NULL GROUP BY 1 ORDER BY 1`,
      describe: (r) => describeTrend(r, value, m1 ? m1.name : "kayıt sayısı"),
    });
  }

  if (d1) {
    const agg = m1 ? `SUM(${q(m1.name)})` : "COUNT(*)";
    plans.push({
      id: "share",
      title: m1 ? `${d1.name} bazında ${m1.name} dağılımı` : `${d1.name} dağılımı`,
      chart: "bar",
      sql: `SELECT ${q(d1.name)}, ${agg} AS toplam, ${agg} / SUM(${agg}) OVER () AS pay FROM data GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 12`,
      describe: (r) => describeShare(r, d1.name, m1 ? totalLabel(m1.name) : "kayıtlar"),
    });
  }

  const rateDim = d2 ?? d1;
  if (f1 && rateDim) {
    const rateCol = `${f1.name}_orani`;
    plans.push({
      id: "rate",
      title: `${rateDim.name} bazında ${f1.name} oranı`,
      chart: "bar",
      sql: `SELECT ${q(rateDim.name)}, AVG(CASE WHEN ${q(f1.name)} THEN 1 ELSE 0 END) AS ${q(rateCol)}, COUNT(*) AS kayit FROM data GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      describe: (r) => describeRate(r, rateDim.name, rateCol, f1.name),
    });
  }

  if (m1 && m2) {
    plans.push({
      id: "correlation",
      title: `${m1.name} ile ${m2.name} ilişkisi`,
      chart: "scatter",
      // Dağılım grafiği için tekrarlanabilir örneklem; korelasyon katsayısı tüm veri üzerinden hesaplanır.
      sql: `SELECT ${q(m1.name)}, ${q(m2.name)} FROM data WHERE ${q(m1.name)} IS NOT NULL AND ${q(m2.name)} IS NOT NULL USING SAMPLE reservoir(800 ROWS) REPEATABLE (7)`,
      statsSql: `SELECT corr(${q(m1.name)}, ${q(m2.name)}) AS r FROM data`,
      describe: (_r, stats) => describeCorrelation(toNum(stats?.r), m1.name, m2.name),
    });
  }

  plans.push({
    id: "quality",
    title: "Veri kalitesi",
    chart: "kpi",
    sql: "SELECT COUNT(*) AS kayit, COUNT(*) - (SELECT COUNT(*) FROM (SELECT DISTINCT * FROM data)) AS tekrar_eden_kayit FROM data",
    describe: (r) => describeQuality(r, profile.columns),
  });

  return plans;
}

interface Runner {
  query(sql: string): Promise<QueryResult>;
}

/** Planları sırayla tarayıcıdaki motorda çalıştırır; hata veren ya da bulgu çıkmayan içgörü sessizce atlanır. */
export async function runExplore(engine: Runner, profile: DatasetProfile): Promise<Insight[]> {
  const insights: Insight[] = [];
  for (const plan of planInsights(profile)) {
    const started = performance.now();
    try {
      const result = await engine.query(plan.sql);
      const stats = plan.statsSql ? (await engine.query(plan.statsSql)).rows[0] : undefined;
      const headline = plan.describe(result, stats);
      if (!headline) continue;
      insights.push({ id: plan.id, title: plan.title, headline, sql: plan.sql, chart: plan.chart, result, ms: Math.round(performance.now() - started) });
    } catch {
      // Beklenmeyen veri biçimi (ör. tarih sütunu metin) içgörüyü atlatır; keşfin geri kalanı çalışmaya devam eder.
    }
  }
  return insights;
}

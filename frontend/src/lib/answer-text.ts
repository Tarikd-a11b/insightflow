/**
 * Sonuçtan doğrudan cevap cümlesi: model açıklaması sorgunun ne yaptığını söyler, bu ise ne bulunduğunu.
 * Alan bilgisi olmayan kullanıcı tabloyu okumadan cevabı görsün diye. Model çağrısı yoktur; cümleler yalnızca
 * sonuç tablosundaki sayılardan kurulur, neden ya da tavsiye içermez.
 */

import { columnRoles, humanize, isRate } from "./chart-spec";
import type { QueryResult } from "./data/types";
import { describeCorrelation } from "./explore";
import { fmtChange, fmtNum, periodLabel } from "./why";

const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
/** Toplamın payı ancak toplanabilir değerlerde anlamlı; ortalama/oran/medyan gibi adlarda pay verilmez. */
const NON_ADDITIVE = /(ort|avg|mean|ortalama|medyan|median|oran|rate|ratio|yuzde|yüzde|percent|min|max|en_)/i;

const toNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const label = (v: unknown) => (v === null || v === undefined || v === "" ? "(boş)" : String(v));

function fmt(result: QueryResult, col: string, v: number): string {
  return isRate(result, col) ? pct.format(v) : fmtNum(v);
}

function kpiAnswer(result: QueryResult, numbers: string[]): string | null {
  const row = result.rows[0];
  const parts = numbers
    .map((c) => ({ c, v: toNum(row[c]) }))
    .filter((p): p is { c: string; v: number } => p.v !== null)
    .slice(0, 4)
    .map((p) => `${humanize(p.c)}: ${fmt(result, p.c, p.v)}`);
  return parts.length > 0 ? `${parts.join(" · ")}.` : null;
}

function rankingAnswer(result: QueryResult, dim: string, value: string, partial = false): string | null {
  const rows = result.rows
    .map((r) => ({ key: label(r[dim]), v: toNum(r[value]) }))
    .filter((r): r is { key: string; v: number } => r.v !== null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b.v - a.v);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const name = humanize(value).toLocaleLowerCase("tr-TR");
  const total = rows.reduce((a, r) => a + r.v, 0);
  const shareable = !partial && !isRate(result, value) && !NON_ADDITIVE.test(value) && rows.every((r) => r.v >= 0) && total > 0;

  const sentences = [`En yüksek ${name}: ${top.key} (${fmt(result, value, top.v)}${shareable ? `, toplamın ${pct.format(top.v / total)} kadarı` : ""}).`];
  sentences.push(`En düşük: ${bottom.key} (${fmt(result, value, bottom.v)}).`);
  if (shareable && rows.length > 4) {
    const top3 = sorted.slice(0, 3).reduce((a, r) => a + r.v, 0);
    sentences.push(`İlk 3 değer toplamın ${pct.format(top3 / total)} kadarını oluşturuyor.`);
  } else if (rows.length === 2 && bottom.v > 0 && top.v / bottom.v >= 1.1) {
    sentences.push(`${top.key}, ${bottom.key} değerinin ${fmtNum(Math.round((top.v / bottom.v) * 10) / 10)} katı.`);
  }
  return sentences.join(" ");
}

function trendAnswer(result: QueryResult, time: string, value: string): string | null {
  const points = result.rows
    .map((r) => ({ t: String(r[time]), v: toNum(r[value]) }))
    .filter((p): p is { t: string; v: number } => p.v !== null)
    .sort((a, b) => a.t.localeCompare(b.t));
  if (points.length < 2) return null;
  const periods = points.map((p) => p.t);
  const at = (p: string) => periodLabel(p, periods);
  const first = points[0];
  const last = points[points.length - 1];
  const peak = points.reduce((a, b) => (b.v > a.v ? b : a));
  const low = points.reduce((a, b) => (b.v < a.v ? b : a));
  const name = humanize(value);
  const change = isRate(result, value)
    ? `${pct.format(first.v)} → ${pct.format(last.v)}`
    : `${fmtNum(first.v)} → ${fmtNum(last.v)} (${fmtChange(first.v, last.v)})`;
  const sentences = [`${name}, ${at(first.t)} → ${at(last.t)}: ${change}.`];
  if (points.length >= 3) sentences.push(`En yüksek dönem ${at(peak.t)} (${fmt(result, value, peak.v)}), en düşük ${at(low.t)} (${fmt(result, value, low.v)}).`);
  return sentences.join(" ");
}

/** Uzun biçim (dönem, kategori, değer): son dönemde öne çıkan kategori. */
function latestLeaderAnswer(result: QueryResult, time: string, dim: string, value: string): string | null {
  const periods = [...new Set(result.rows.map((r) => String(r[time])))].sort();
  const last = periods[periods.length - 1];
  const rows = result.rows.filter((r) => String(r[time]) === last);
  const ranking = rankingAnswer({ ...result, rows }, dim, value);
  return ranking ? `${periodLabel(last, periods)} döneminde: ${ranking}` : null;
}

/** `partial`: sonuç satır sınırında kesildi; toplamın payı eksik toplamla hesaplanacağı için verilmez. */
export function describeResult(result: QueryResult, partial = false): string | null {
  if (result.rows.length === 0) return null;
  const roles = columnRoles(result);
  const of = (role: string) => result.columns.filter((c) => roles[c] === role);
  const numbers = of("number");
  const times = of("time");
  const cats = of("category");
  if (numbers.length === 0) return null;

  if (result.rows.length === 1) return kpiAnswer(result, numbers);
  if (times.length === 1 && cats.length === 0) return trendAnswer(result, times[0], numbers[0]);
  if (times.length === 1 && cats.length === 1) return latestLeaderAnswer(result, times[0], cats[0], numbers[0]);
  const labels = [...cats, ...times];
  if (labels.length === 1) return rankingAnswer(result, labels[0], numbers[0], partial);
  if (labels.length === 0 && numbers.length >= 2 && result.rows.length >= 3) {
    const xs = result.rows.map((r) => toNum(r[numbers[0]]));
    const ys = result.rows.map((r) => toNum(r[numbers[1]]));
    return describeCorrelation(pearson(xs, ys), humanize(numbers[0]), humanize(numbers[1]));
  }
  return null;
}

export function pearson(xs: (number | null)[], ys: (number | null)[]): number | null {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
  const my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

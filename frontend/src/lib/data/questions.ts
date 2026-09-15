import type { ColumnProfile } from "./types";

// İş verisinde "asıl ölçü" olmaya aday sütun adları (Türkçe + İngilizce). Toplanabilir tutarlar,
// toplanması anlamsız birim değerlerden (fiyat) önce gelir.
const MEASURE_STRONG = /(tutar|toplam|gelir|ciro|satis|satış|kar|kâr|revenue|sales|amount|total|profit|mrr|arr)/i;
const MEASURE_WEAK = /(fiyat|maliyet|gider|price|cost|usd|try|eur)/i;

/** "toplam toplam_tutar" gibi tekrarları önler. */
const sum = (c: ColumnProfile) => (/(toplam|total|sum)/i.test(c.name) ? c.name : `toplam ${c.name}`);

function measureScore(c: ColumnProfile): number {
  // Ada göre ipucu en güçlü sinyal; sonra değer çeşitliliği (1–4 arası "adet" gibi sütunlar geride kalır).
  const hint = MEASURE_STRONG.test(c.name) ? 100 : MEASURE_WEAK.test(c.name) ? 50 : 0;
  return hint + Math.min(c.distinct, 1000) / 100;
}

function dimensionScore(c: ColumnProfile): number {
  // Grafikte en okunur aralık yaklaşık 5–12 kategori.
  const d = c.distinct;
  if (d < 2) return -100;
  return d <= 12 ? d : 24 - d;
}

export interface RankedColumns {
  /** Toplanabilir ölçüler, en anlamlısı başta. */
  measures: ColumnProfile[];
  dates: ColumnProfile[];
  flags: ColumnProfile[];
  /** Kırılım olarak okunur kategorik metin sütunları, grafikte en okunuru başta. */
  dims: ColumnProfile[];
}

/** Öneri soruları ve otomatik keşif aynı sütun seçimini kullanır. */
export function rankColumns(columns: ColumnProfile[]): RankedColumns {
  const usable = columns.filter((c) => !c.identifier);
  return {
    measures: usable.filter((c) => c.kind === "numeric").sort((a, b) => measureScore(b) - measureScore(a)),
    dates: usable.filter((c) => c.kind === "temporal"),
    flags: usable.filter((c) => c.kind === "boolean"),
    dims: usable.filter((c) => c.kind === "text" && c.categorical).sort((a, b) => dimensionScore(b) - dimensionScore(a)),
  };
}

/**
 * Birleştirme gerektiren örnek sorular: ek tablodaki bir kırılımla ana tablodaki ölçü (ör. musteriler.segment bazında
 * siparişlerin toplam tutarı). Yalnızca tablolar arasında ilişki bulunduysa önerilir.
 */
export function suggestJoinQuestions(
  primary: ColumnProfile[],
  extras: { table: string; columns: ColumnProfile[] }[],
  relatedTables: Set<string>,
  limit = 2,
): string[] {
  const [m1] = rankColumns(primary).measures;
  const out: string[] = [];
  for (const extra of extras) {
    if (!relatedTables.has(extra.table)) continue;
    const [dim] = rankColumns(extra.columns).dims;
    if (!dim) continue;
    out.push(m1 ? `${extra.table} tablosundaki ${dim.name} bazında ${sum(m1)} nedir?` : `${extra.table} tablosundaki ${dim.name} bazında kayıt sayısı nedir?`);
  }
  return out.slice(0, limit);
}

/**
 * Şemadan kural tabanlı örnek sorular üretir. LLM çağrısı yapmaz; yalnızca sütun adı,
 * tipi ve yerelde hesaplanan profil kullanılır.
 */
export function suggestQuestions(columns: ColumnProfile[], limit = 6): string[] {
  const { measures, dates, flags, dims } = rankColumns(columns);

  const out: string[] = [];
  const add = (q: string) => {
    if (!out.includes(q)) out.push(q);
  };

  const [m1, m2] = measures;
  const [d1, d2] = dims;
  const [t1] = dates;
  const [f1] = flags;

  if (t1 && m1) add(`Aylara göre ${sum(m1)} nasıl değişti?`);
  if (d1 && m1) add(`${d1.name} bazında ${sum(m1)} nedir?`);
  if (f1 && (d2 ?? d1)) add(`${(d2 ?? d1).name} bazında ${f1.name} oranı nedir?`);
  if (d2 && m1) add(`Ortalama ${m1.name} en yüksek olan ${d2.name} hangisi?`);
  if (m1 && m2) add(`${m1.name} ile ${m2.name} arasında bir ilişki var mı?`);
  if (t1 && !m1) add(`Aylara göre kayıt sayısı nasıl değişti?`);
  if (d1) add(`Kayıtların ${d1.name} dağılımı nasıl?`);
  if (m1) add(`${m1.name} için ortalama, medyan ve en yüksek değer nedir?`);
  if (out.length === 0) add(`Bu veri setinde kaç kayıt var?`);

  return out.slice(0, limit);
}

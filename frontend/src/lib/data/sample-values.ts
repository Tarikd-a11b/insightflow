import type { ColumnProfile } from "./types";

/**
 * Onaylı örnek değer paylaşımı. Varsayılan kapalıdır; modele yalnızca şema gider. Kullanıcı açarsa, az kategorili
 * metin sütunlarının değerleri (ör. islem_turu: Gelir, Gider) gönderilir. Model böylece filtrelerde doğru yazımı
 * kullanır ve "net kâr" gibi soruları yanlışlıkla reddetmez (bkz. backend/scripts/eval_llm.py --with-values).
 */

export const MAX_SHARED_VALUES = 12;
export const MAX_VALUE_LENGTH = 60;

/** Paylaşılmaya aday sütunlar: kimlik olmayan, en fazla 12 farklı değeri olan metin sütunları. */
export function sampleValueCandidates(columns: ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.kind === "text" && !c.identifier && c.distinct >= 1 && c.distinct <= MAX_SHARED_VALUES);
}

export type SharedValues = Record<string, string[]>;

// Satır sonu dahil kontrol karakterleri (kod noktası 0-31) boşluğa çevrilir.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, "g");

/** Paylaşılan değerlerin toplam sayısı (şerit ve panel için). */
export function countSharedValues(shared: SharedValues): number {
  return Object.values(shared).reduce((n, values) => n + values.length, 0);
}

export function normalizeValues(raw: unknown[]): string[] {
  const seen = new Set<string>();
  for (const v of raw) {
    if (v === null || v === undefined) continue;
    const s = String(v).replace(CONTROL_CHARS, " ").trim().slice(0, MAX_VALUE_LENGTH);
    if (s) seen.add(s);
  }
  return [...seen].slice(0, MAX_SHARED_VALUES);
}

import type { ColumnProfile } from "./types";

/** Ana tablo her zaman `data`; eklenen dosyalar kendi adlarından türetilen tablolar olur. */
export const PRIMARY_TABLE = "data";
export const MAX_EXTRA_TABLES = 4;

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", i̇: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
// Tablo adı olarak kullanıldığında SQL'i bozacak ya da kafa karıştıracak kelimeler.
const RESERVED = new Set(["data", "select", "from", "where", "group", "order", "by", "join", "table", "user", "limit", "union", "with", "on", "as"]);

/**
 * Dosya adından backend'in kabul ettiği tablo adını üretir: ^[a-z][a-z0-9_]{0,39}$, `data` değil, benzersiz.
 * "Müşteri Listesi 2025.xlsx" → "musteri_listesi_2025".
 */
export function tableNameFromFile(fileName: string, taken: Iterable<string> = []): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  let name = base
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]|i̇/g, (ch) => TR_MAP[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(name)) name = `t_${name}`.replace(/_+$/, "");
  if (name === "t") name = "tablo";
  if (RESERVED.has(name)) name = `${name}_tablo`;
  name = name.slice(0, 36).replace(/_+$/, "");

  const used = new Set([PRIMARY_TABLE, ...taken]);
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) candidate = `${name}_${i}`;
  return candidate;
}

export interface RelationshipCandidate {
  left: { table: string; column: string };
  right: { table: string; column: string };
}

const compatible = (a: ColumnProfile, b: ColumnProfile) =>
  a.kind === b.kind && (a.kind === "text" || a.kind === "numeric");

/**
 * Aynı adı ve uyumlu tipi taşıyan sütunlar birleştirme adayıdır (ör. siparisler.musteri_id ↔ musteriler.musteri_id).
 * Sol taraf her zaman ana tabloya daha yakın olandır: önce `data`, sonra ekleme sırası.
 */
export function relationshipCandidates(tables: { table: string; columns: ColumnProfile[] }[]): RelationshipCandidate[] {
  const out: RelationshipCandidate[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i];
      const b = tables[j];
      for (const ca of a.columns) {
        // Yerel ayarsız küçük harf: tr-TR'de "ID" → "ıd" olur ve Musteri_ID ile musteri_id eşleşmezdi.
        const cb = b.columns.find((c) => c.name.toLowerCase() === ca.name.toLowerCase());
        if (!cb || !compatible(ca, cb)) continue;
        // Birkaç farklı değeri olan sütunlar (ör. "durum") anahtar değildir; birleştirme satırları çoğaltır.
        if (Math.max(ca.distinct, cb.distinct) < 20) continue;
        out.push({ left: { table: a.table, column: ca.name }, right: { table: b.table, column: cb.name } });
      }
    }
  }
  return out;
}

export interface Relationship extends RelationshipCandidate {
  /** Sol tablodaki farklı anahtar değerlerinin sağ tabloda bulunan oranı (0–1). Yalnızca arayüzde gösterilir. */
  coverage: number;
}

/** Modele giden ilişki: yalnızca `tablo.sütun` çiftleri (oran ve değer gitmez). */
export function relationshipPayload(relationships: Relationship[]): { left: string; right: string }[] {
  return relationships.map((r) => ({ left: `${r.left.table}.${r.left.column}`, right: `${r.right.table}.${r.right.column}` }));
}

export const MIN_COVERAGE = 0.3;

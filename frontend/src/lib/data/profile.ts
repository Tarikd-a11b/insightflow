import type { ColumnKind, ColumnProfile } from "./types";

/** SQL tanımlayıcısını çift tırnakla güvenli biçimde sarar. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL)/;
const TEMPORAL = /^(DATE|TIME|TIMESTAMP)/;

export function classifyType(duckdbType: string): ColumnKind {
  const t = duckdbType.toUpperCase();
  if (NUMERIC.test(t)) return "numeric";
  if (TEMPORAL.test(t)) return "temporal";
  if (t === "BOOLEAN") return "boolean";
  if (t === "VARCHAR" || t.startsWith("VARCHAR(") || t === "UUID") return "text";
  return "other";
}

const ID_NAME = /(^id$|_id$|^id_|uuid|guid)/i;

/** `SELECT ... FROM (SUMMARIZE data)` sorgusunun ham satırı. */
export interface SummarizeRow {
  column_name: string;
  column_type: string;
  min: string | null;
  max: string | null;
  approx_unique: number | null;
  null_percentage: number | null;
}

export function summarizeSql(table = "data"): string {
  return `SELECT column_name, column_type, min, max,
  approx_unique::DOUBLE AS approx_unique, null_percentage::DOUBLE AS null_percentage
FROM (SUMMARIZE ${quoteIdent(table)})`;
}

/**
 * SUMMARIZE'ın approx_unique değeri HyperLogLog tahmini; az kategorili sütunlarda bile
 * yanılabiliyor (8 şehir için 9 gibi). Profilde kesin sayıyı göstermek için tek sorguda sayıyoruz.
 */
export function buildDistinctSql(columnNames: string[], table = "data"): string {
  const parts = columnNames.map((name, i) => `count(DISTINCT ${quoteIdent(name)})::DOUBLE AS c${i}`);
  return `SELECT ${parts.join(", ")} FROM ${quoteIdent(table)}`;
}

export function buildColumnProfiles(
  rows: SummarizeRow[],
  rowCount: number,
  exactDistinct?: Map<string, number>,
): ColumnProfile[] {
  return rows.map((r) => {
    const kind = classifyType(r.column_type);
    // approx_unique bir tahmin; satır sayısını aşabilir.
    const distinct = Math.min(Math.round(exactDistinct?.get(r.column_name) ?? r.approx_unique ?? 0), rowCount);
    const nearlyUnique = rowCount > 20 && distinct >= rowCount * 0.95;
    const identifier =
      (ID_NAME.test(r.column_name) && (kind === "numeric" || kind === "text")) ||
      (kind === "text" && nearlyUnique);
    const categorical =
      !identifier &&
      (kind === "boolean" ||
        (kind === "text" && distinct > 0 && (distinct <= 50 || distinct <= rowCount * 0.05)));
    return {
      name: r.column_name,
      type: r.column_type,
      kind,
      min: r.min,
      max: r.max,
      distinct,
      nullPercent: r.null_percentage ?? 0,
      categorical,
      identifier,
    };
  });
}

export type ColumnKind = "numeric" | "temporal" | "boolean" | "text" | "other";

/** DuckDB `SUMMARIZE` çıktısından türetilen sütun profili. Yalnızca tarayıcıda kalır. */
export interface ColumnProfile {
  name: string;
  type: string;
  kind: ColumnKind;
  min: string | null;
  max: string | null;
  distinct: number;
  nullPercent: number;
  /** Kategorik gibi davranan metin/boolean sütun (az sayıda benzersiz değer). */
  categorical: boolean;
  /** Kimlik sütunu gibi görünüyor (analizde ölçü/kırılım olarak önerilmez). */
  identifier: boolean;
}

export interface DatasetProfile {
  name: string;
  rowCount: number;
  columns: ColumnProfile[];
  loadMs: number;
}

/** Motordaki bir tablo: ana tablo `data`, eklenen dosyalar kendi adlarıyla. */
export interface TableProfile extends DatasetProfile {
  table: string;
  sizeBytes: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  ms: number;
}

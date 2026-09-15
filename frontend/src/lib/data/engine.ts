"use client";

import * as duckdb from "@duckdb/duckdb-wasm";
import { Type, type Table } from "apache-arrow";
import { buildColumnProfiles, buildDistinctSql, quoteIdent, summarizeSql, type SummarizeRow } from "./profile";
import type { QueryResult, TableProfile } from "./types";

export interface TableInput {
  file: File;
  /** SQL tablo adı (ilk tablo her zaman `data`). */
  table: string;
  displayName: string;
}

/**
 * Tarayıcı içi veri motoru. Her veri seti kendi DuckDB örneğinde yaşar: dosyalar tablolara alınır (ilki `data`),
 * ardından motor dış erişime kilitlenir.
 * Hiçbir satır sunucuya gönderilmez.
 */

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: "/duckdb/duckdb-mvp.wasm", mainWorker: "/duckdb/duckdb-browser-mvp.worker.js" },
  eh: { mainModule: "/duckdb/duckdb-eh.wasm", mainWorker: "/duckdb/duckdb-browser-eh.worker.js" },
};

export type SourceFormat = "csv" | "parquet" | "excel";

export function detectFormat(fileName: string): SourceFormat | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  if (ext === "parquet") return "parquet";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return null;
}

async function toDuckDbInput(file: File, format: SourceFormat, index: number): Promise<{ name: string; bytes: Uint8Array; reader: string }> {
  if (format === "excel") {
    // Excel'i önce yerelde CSV'ye çeviriyoruz; DuckDB'nin excel eklentisi ağdan indirilmek zorunda.
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(sheet, { dateNF: "yyyy-mm-dd" });
    return { name: `upload_${index}.csv`, bytes: new TextEncoder().encode(csv), reader: "read_csv_auto" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return format === "parquet"
    ? { name: `upload_${index}.parquet`, bytes, reader: "read_parquet" }
    : { name: `upload_${index}.csv`, bytes, reader: "read_csv_auto" };
}

/** Türkçe bölge ayarlı Excel'in CSV çıktısı `;` ile ayrılır ve ondalıkta virgül kullanır. */
async function csvOptions(conn: duckdb.AsyncDuckDBConnection, fileName: string): Promise<string> {
  try {
    const res = await conn.query(`SELECT Delimiter AS d FROM sniff_csv('${fileName}')`);
    return String(res.toArray()[0].d) === ";" ? ", decimal_separator = ','" : "";
  } catch {
    return "";
  }
}

function toPlain(value: unknown, typeId: Type): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeId === Type.Date || typeId === Type.Timestamp) {
    const d = value instanceof Date ? value : new Date(value as number);
    const iso = d.toISOString();
    return typeId === Type.Date || iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace("T", " ").slice(0, 19);
  }
  return value;
}

function tableToResult(table: Table, ms: number): QueryResult {
  const fields = table.schema.fields;
  const rows = table.toArray().map((row) => {
    const obj: Record<string, unknown> = {};
    for (const f of fields) obj[f.name] = toPlain(row[f.name], f.typeId);
    return obj;
  });
  return { columns: fields.map((f) => f.name), rows, ms };
}

export class DataEngine {
  private constructor(
    private db: duckdb.AsyncDuckDB,
    private worker: Worker,
    private conn: duckdb.AsyncDuckDBConnection,
  ) {}

  static async create(): Promise<DataEngine> {
    const bundle = await duckdb.selectBundle(BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule);
    await db.open({
      query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true },
    });
    const conn = await db.connect();
    // Eklentiler (parquet, json) varsayılan olarak extensions.duckdb.org'dan indirilir; kendi alan adımıza yönlendir.
    // scripts/copy-duckdb.mjs derleme sırasında bu dosyaları public/duckdb/extensions altına koyar.
    const repo = `${window.location.origin}/duckdb/extensions`;
    await conn.query(`SET custom_extension_repository = '${repo}'`);
    await conn.query(`SET autoinstall_extension_repository = '${repo}'`);
    return new DataEngine(db, worker, conn);
  }

  /**
   * Dosyaları tablolara alır (ilki `data`), ardından motoru dış erişime kilitler ve her tablonun profilini döndürür.
   * Kilit tek yönlüdür: sonradan dosya eklemek için yeni bir motor örneğiyle tüm dosyalar yeniden yüklenir.
   */
  async loadTables(inputs: TableInput[]): Promise<TableProfile[]> {
    for (const input of inputs) {
      if (!detectFormat(input.file.name)) {
        throw new Error(`"${input.file.name}" desteklenmiyor. CSV, Parquet veya Excel (.xlsx) yükleyin.`);
      }
    }
    const started = performance.now();

    for (const [i, input] of inputs.entries()) {
      const source = await toDuckDbInput(input.file, detectFormat(input.file.name)!, i);
      await this.db.registerFileBuffer(source.name, source.bytes);
      const options = source.reader === "read_csv_auto" ? await csvOptions(this.conn, source.name) : "";
      await this.conn.query(`CREATE TABLE ${quoteIdent(input.table)} AS SELECT * FROM ${source.reader}('${source.name}'${options})`);
      await this.db.dropFile(source.name);
    }

    // Veri içeride; bundan sonra hiçbir sorgu dosya veya ağa erişemez ve bu ayar geri açılamaz.
    await this.conn.query("SET enable_external_access = false");
    await this.conn.query("SET lock_configuration = true");
    await this.assertLocked();

    const profiles: TableProfile[] = [];
    for (const input of inputs) {
      const table = quoteIdent(input.table);
      const rowCount = Number((await this.conn.query(`SELECT count(*)::DOUBLE AS n FROM ${table}`)).toArray()[0].n);
      const summary = tableToResult(await this.conn.query(summarizeSql(input.table)), 0).rows as unknown as SummarizeRow[];
      const names = summary.map((r) => r.column_name);
      const distinctRow = (await this.conn.query(buildDistinctSql(names, input.table))).toArray()[0];
      const exact = new Map(names.map((n, i) => [n, Number(distinctRow[`c${i}`])]));
      profiles.push({
        table: input.table,
        name: input.displayName,
        rowCount,
        columns: buildColumnProfiles(summary, rowCount, exact),
        loadMs: Math.round(performance.now() - started),
        sizeBytes: input.file.size,
      });
    }
    return profiles;
  }

  /** Sol tablodaki farklı anahtar değerlerinden kaçının sağ tabloda bulunduğu (0–1). Değerler tarayıcıdan çıkmaz. */
  async joinCoverage(left: { table: string; column: string }, right: { table: string; column: string }): Promise<number> {
    const l = quoteIdent(left.column);
    const r = quoteIdent(right.column);
    const res = await this.conn.query(
      `SELECT COUNT(DISTINCT a.${l})::DOUBLE AS n, COUNT(DISTINCT a.${l}) FILTER (WHERE b.k IS NOT NULL)::DOUBLE AS matched
       FROM ${quoteIdent(left.table)} a LEFT JOIN (SELECT DISTINCT ${r} AS k FROM ${quoteIdent(right.table)}) b ON a.${l} = b.k`,
    );
    const row = res.toArray()[0];
    return Number(row.n) > 0 ? Number(row.matched) / Number(row.n) : 0;
  }
  /** Kilidin gerçekten devrede olduğunu doğrular; değilse veri setini kullanıma açmaz. */
  private async assertLocked(): Promise<void> {
    // Ayarı geri açmayı deneyerek doğrulamak da mümkün, ama worker her reddi konsola hata olarak basıyor ve
    // kullanıcıyı yanıltıyordu. İki ayarın güncel değerini okumak aynı güvenceyi sessizce veriyor.
    const res = await this.conn.query(
      "SELECT current_setting('enable_external_access')::VARCHAR AS ext, current_setting('lock_configuration')::VARCHAR AS locked",
    );
    const row = res.toArray()[0];
    if (String(row.ext).toLowerCase() !== "false" || String(row.locked).toLowerCase() !== "true") {
      throw new Error("Güvenlik kilidi uygulanamadı (dış erişim açık veya ayarlar değiştirilebilir).");
    }
  }

  /** Bir sütunun farklı değerleri (örnek değer paylaşım önizlemesi için); `limit`+1 okunur ki fazlası anlaşılsın. */
  async distinctValues(table: string, column: string, limit: number): Promise<unknown[]> {
    const col = quoteIdent(column);
    const result = await this.conn.query(
      `SELECT DISTINCT ${col}::VARCHAR AS v FROM ${quoteIdent(table)} WHERE ${col} IS NOT NULL ORDER BY 1 LIMIT ${limit + 1}`,
    );
    return result.toArray().map((r) => r.v);
  }

  async query(sql: string): Promise<QueryResult> {
    const started = performance.now();
    const table = await this.conn.query(sql);
    return tableToResult(table, Math.round(performance.now() - started));
  }

  async dispose(): Promise<void> {
    await this.conn.close().catch(() => {});
    await this.db.terminate().catch(() => {});
    this.worker.terminate();
  }
}

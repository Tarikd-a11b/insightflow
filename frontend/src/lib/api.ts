import type { ColumnProfile } from "./data/types";
import { outboundLog, type OutboundKind } from "./outbound-log";

/** Aynı alan adındaki vekil; next.config.ts `/api/*` isteklerini gerçek API'ye iletir. */
export const API_URL = "/api";

export type ChartKind = "line" | "bar" | "scatter" | "kpi" | "table";

export type SqlResponse =
  | { status: "ok"; sql: string; explanation: string; chart: ChartKind; limited: boolean }
  | { status: "unanswerable"; reason: string };

/**
 * Modele giden şema: ad ve tip. Profil (min/max, benzersiz sayı) gönderilmez. `values` yalnızca kullanıcının
 * onayla paylaştığı az kategorili sütunlarda bulunur.
 */
export interface ColumnPayload {
  name: string;
  type: string;
  values?: string[];
}

/** `keyPrefix`: ek tablolarda paylaşılan değerlerin anahtarı `tablo.sütun` biçimindedir. */
export function toColumnPayload(columns: ColumnProfile[], shared: Record<string, string[]> = {}, keyPrefix = ""): ColumnPayload[] {
  return columns.map((c) => {
    const values = shared[keyPrefix + c.name];
    return values?.length ? { name: c.name, type: c.type, values } : { name: c.name, type: c.type };
  });
}

export interface TablePayload {
  name: string;
  columns: ColumnPayload[];
}

/** Modele giden şemanın tamamı: ana tablo `data`nın sütunları, varsa ek tablolar ve eşleşen sütun çiftleri. */
export interface SchemaPayload {
  columns: ColumnPayload[];
  tables?: TablePayload[];
  relationships?: { left: string; right: string }[];
}

/** Boş alanlar gövdeye hiç yazılmaz: tek tablolu sorularda istek önceki hâliyle birebir aynı kalır. */
function schemaBody(schema: SchemaPayload): Record<string, unknown> {
  return {
    columns: schema.columns,
    ...(schema.tables?.length ? { tables: schema.tables } : {}),
    ...(schema.relationships?.length ? { relationships: schema.relationships } : {}),
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const UNREACHABLE = "Yanıt motoruna ulaşılamadı. Backend çalışıyor mu?";

/** Tüm modele giden istekler buradan geçer ve gövdeleri birebir kayda alınır. */
async function postJson<T>(kind: OutboundKind, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const logId = outboundLog.record(kind, body);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    outboundLog.settle(logId, 0);
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(UNREACHABLE, 0);
  }
  outboundLog.settle(logId, res.status);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : `İstek başarısız oldu (${res.status}).`;
    throw new ApiError(detail, res.status);
  }
  return data as T;
}

/** Takip sorusu bağlamı: önceki soru ve SQL'i. Sonuç satırı taşımaz. */
export interface HistoryItem {
  question: string;
  sql: string;
}

export function requestSql(question: string, schema: SchemaPayload, signal?: AbortSignal, history: HistoryItem[] = []) {
  return postJson<SqlResponse>("sql", "/sql", { question, ...schemaBody(schema), ...(history.length ? { history } : {}) }, signal);
}

export function requestRepair(
  args: { question: string; schema: SchemaPayload; sql: string; error: string; attempt: number; history?: HistoryItem[] },
  signal?: AbortSignal,
) {
  const { schema, history, ...rest } = args;
  return postJson<SqlResponse>(
    "repair",
    "/repair",
    { question: rest.question, ...schemaBody(schema), sql: rest.sql, error: rest.error, attempt: rest.attempt, ...(history?.length ? { history } : {}) },
    signal,
  );
}

export const SUMMARY_MAX_ROWS = 20;
export const SUMMARY_MAX_COLUMNS = 8;

export async function requestSummary(args: {
  question: string;
  sql: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  /** Sonucu üreten SQL'in okuyabileceği ek tablolar (sunucudaki toplulaştırma doğrulaması için). */
  tables?: string[];
}): Promise<string> {
  const { tables, ...rest } = args;
  const data = await postJson<{ summary: string }>("summary", "/summary", { ...rest, ...(tables?.length ? { tables } : {}) });
  return String(data.summary);
}

/** Özet için modele gidecek tabloyu hazırlar; uygun değilse nedenini döner. */
export function summaryPayload(result: { columns: string[]; rows: Record<string, unknown>[] }):
  | { ok: true; columns: string[]; rows: (string | number | boolean | null)[][] }
  | { ok: false; reason: string } {
  if (result.rows.length > SUMMARY_MAX_ROWS) {
    return { ok: false, reason: `Özet en fazla ${SUMMARY_MAX_ROWS} satırlık toplu sonuçlar için yapılabilir.` };
  }
  if (result.columns.length > SUMMARY_MAX_COLUMNS) {
    return { ok: false, reason: `Özet en fazla ${SUMMARY_MAX_COLUMNS} sütunlu sonuçlar için yapılabilir.` };
  }
  const cell = (v: unknown) =>
    v === null || v === undefined ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 120);
  return { ok: true, columns: result.columns, rows: result.rows.map((r) => result.columns.map((c) => cell(r[c]))) };
}

export type BackendHealth = "ok" | "unconfigured" | "unreachable";

export async function checkHealth(): Promise<BackendHealth> {
  try {
    // Uyanmakta olan sunucu bağlantıyı uzun süre açık tutabilir; tek denemeyi kısa tutup yeniden deneriz.
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return "unreachable";
    const data = await res.json();
    return data?.llm_configured ? "ok" : "unconfigured";
  } catch {
    return "unreachable";
  }
}

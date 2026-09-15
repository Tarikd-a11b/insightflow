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

export function toColumnPayload(columns: ColumnProfile[], shared: Record<string, string[]> = {}): ColumnPayload[] {
  return columns.map((c) => (shared[c.name]?.length ? { name: c.name, type: c.type, values: shared[c.name] } : { name: c.name, type: c.type }));
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

export function requestSql(question: string, columns: ColumnPayload[], signal?: AbortSignal) {
  return postJson<SqlResponse>("sql", "/sql", { question, columns }, signal);
}

export function requestRepair(
  args: { question: string; columns: ColumnPayload[]; sql: string; error: string; attempt: number },
  signal?: AbortSignal,
) {
  return postJson<SqlResponse>("repair", "/repair", args, signal);
}

export const SUMMARY_MAX_ROWS = 20;
export const SUMMARY_MAX_COLUMNS = 8;

export async function requestSummary(args: {
  question: string;
  sql: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
}): Promise<string> {
  const data = await postJson<{ summary: string }>("summary", "/summary", args);
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

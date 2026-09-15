import { requestRepair, requestSql, type ChartKind, type ColumnPayload, type HistoryItem, type SqlResponse } from "./api";
import type { QueryResult } from "./data/types";
import { sanitizeError } from "./sanitize";

export const MAX_REPAIRS = 3;

export type AskStep = { kind: "writing" } | { kind: "running" } | { kind: "repairing"; attempt: number };

export type AskOutcome =
  | {
      kind: "answer";
      sql: string;
      explanation: string;
      chart: ChartKind;
      limited: boolean;
      result: QueryResult;
      repairs: number;
      totalMs: number;
    }
  | { kind: "unanswerable"; reason: string }
  | { kind: "failed"; message: string; lastSql?: string };

interface Runner {
  query(sql: string): Promise<QueryResult>;
}

/**
 * Soru → sunucudan doğrulanmış SQL → tarayıcıda çalıştırma. Sorgu hata verirse temizlenmiş hata
 * mesajıyla en fazla MAX_REPAIRS kez onarım istenir. Sonuç satırları hiçbir zaman sunucuya gitmez.
 */
export async function ask(
  engine: Runner,
  question: string,
  columns: ColumnPayload[],
  onStep: (step: AskStep) => void,
  signal?: AbortSignal,
  history: HistoryItem[] = [],
): Promise<AskOutcome> {
  const started = performance.now();
  onStep({ kind: "writing" });
  let response: SqlResponse = await requestSql(question, columns, signal, history);

  for (let repairs = 0; ; repairs++) {
    if (response.status === "unanswerable") return { kind: "unanswerable", reason: response.reason };

    onStep({ kind: "running" });
    try {
      const result = await engine.query(response.sql);
      return {
        kind: "answer",
        sql: response.sql,
        explanation: response.explanation,
        chart: response.chart,
        limited: response.limited,
        result,
        repairs,
        totalMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (repairs >= MAX_REPAIRS) {
        return {
          kind: "failed",
          message: `Sorgu ${MAX_REPAIRS} onarım denemesinden sonra da çalışmadı: ${sanitizeError(raw)}`,
          lastSql: response.sql,
        };
      }
      onStep({ kind: "repairing", attempt: repairs + 1 });
      response = await requestRepair(
        { question, columns, sql: response.sql, error: sanitizeError(raw), attempt: repairs + 1, history },
        signal,
      );
    }
  }
}

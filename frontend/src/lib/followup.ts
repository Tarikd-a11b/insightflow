import type { HistoryItem } from "./api";

/** Takip bağlamı için gereken en küçük tur bilgisi. */
export interface ContextTurn {
  id: number;
  question: string;
  parentId?: number;
  /** Başarılı yanıtın SQL'i; yoksa tur bağlam olarak kullanılamaz. */
  sql?: string;
}

export const MAX_HISTORY = 3;

/**
 * Bağlam turundan geriye doğru ebeveyn zincirini izleyip en fazla MAX_HISTORY adımlık geçmiş kurar (en eski başta).
 * Yanıtı olmayan (başarısız, yanıtlanamaz) turlar zinciri keser: model yalnızca çalışmış SQL'leri temel alır.
 */
export function buildHistory(turns: ContextTurn[], contextId: number | null): HistoryItem[] {
  if (contextId === null) return [];
  const byId = new Map(turns.map((t) => [t.id, t]));
  const chain: HistoryItem[] = [];
  const seen = new Set<number>();
  let current = byId.get(contextId);
  while (current?.sql && chain.length < MAX_HISTORY && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift({ question: current.question, sql: current.sql });
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return chain;
}

/** Varsayılan bağlam: en son başarılı yanıt. */
export function latestAnsweredId(turns: ContextTurn[]): number | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].sql) return turns[i].id;
  return null;
}

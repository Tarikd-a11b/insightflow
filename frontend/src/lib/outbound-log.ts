/**
 * Sunucuya (ve oradan modele) giden her isteğin birebir kaydı. "Modele ne gitti?" paneli ve üst şerit bu
 * kayıttan beslenir; sayılar ayrı ayrı tutulmaz, böylece şeritteki iddia gerçek gövdelerle hep tutarlı kalır.
 */

export type OutboundKind = "sql" | "repair" | "summary";

export interface OutboundEntry {
  id: number;
  kind: OutboundKind;
  at: number;
  body: Record<string, unknown>;
  /** HTTP durumu; ağ hatasında 0, yanıt beklenirken null. */
  status: number | null;
}

type Listener = () => void;

let entries: OutboundEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const outboundLog = {
  record(kind: OutboundKind, body: Record<string, unknown>): number {
    const id = nextId++;
    entries = [...entries, { id, kind, at: Date.now(), body, status: null }];
    emit();
    return id;
  },
  settle(id: number, status: number) {
    entries = entries.map((e) => (e.id === id ? { ...e, status } : e));
    emit();
  },
  clear() {
    entries = [];
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot(): OutboundEntry[] {
    return entries;
  },
};

const EMPTY: OutboundEntry[] = [];
export const serverSnapshot = () => EMPTY;

export interface OutboundTotals {
  /** Modele gönderilen en geniş şemadaki sütun sayısı. */
  columns: number;
  /** Onaylı özetlerle gönderilen toplu sonuç satırları. */
  summaryRows: number;
  requests: number;
}

export function totals(list: OutboundEntry[]): OutboundTotals {
  let columns = 0;
  let summaryRows = 0;
  for (const e of list) {
    // Başarısız (ağa hiç çıkmamış) istekler de sayılır: gövde tarayıcıdan ayrılmış olabilir.
    if (e.kind === "summary") {
      summaryRows += Array.isArray(e.body.rows) ? e.body.rows.length : 0;
    } else if (Array.isArray(e.body.columns)) {
      columns = Math.max(columns, e.body.columns.length);
    }
  }
  return { columns, summaryRows, requests: list.length };
}

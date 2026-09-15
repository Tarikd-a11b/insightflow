import type { ChartKind } from "./api";
import type { QueryResult } from "./data/types";

/**
 * Grafik panosu. Sabitlenen yanıt, sonuç satırlarıyla birlikte yalnızca bu tarayıcının IndexedDB'sinde
 * saklanır; hiçbir sunucuya gitmez. Veri seti kapatılsa ya da sayfa yenilense de pano kalır.
 */

export interface Pin {
  id: string;
  createdAt: number;
  datasetName: string;
  question: string;
  explanation: string;
  sql: string;
  chart: ChartKind;
  result: QueryResult;
}

const DB_NAME = "insightflow";
const STORE = "pins";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

export const pinStore = {
  async list(): Promise<Pin[]> {
    const all = await run<Pin[]>("readonly", (s) => s.getAll() as IDBRequest<Pin[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async add(pin: Omit<Pin, "id" | "createdAt">): Promise<Pin> {
    const full: Pin = { ...pin, id: crypto.randomUUID(), createdAt: Date.now() };
    await run("readwrite", (s) => s.put(full));
    notify();
    return full;
  },
  async remove(id: string): Promise<void> {
    await run("readwrite", (s) => s.delete(id));
    notify();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

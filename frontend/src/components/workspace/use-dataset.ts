"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataEngine, TableInput } from "@/lib/data/engine";
import { MAX_EXTRA_TABLES, MIN_COVERAGE, PRIMARY_TABLE, relationshipCandidates, tableNameFromFile, type Relationship } from "@/lib/data/tables";
import type { QueryResult, TableProfile } from "@/lib/data/types";

export interface ReadyDataset {
  status: "ready";
  /** Ana tablo (`data`). */
  profile: TableProfile;
  /** Ana tablo dahil tüm tablolar, ekleme sırasıyla. */
  tables: TableProfile[];
  relationships: Relationship[];
  previews: Record<string, QueryResult>;
  /** Ana tablonun önizlemesi (geriye uyumluluk). */
  preview: QueryResult;
  sizeBytes: number;
  /** Son dosya ekleme denemesinin hatası; veri seti önceki hâliyle çalışmaya devam eder. */
  addError: string | null;
  /** Dosya eklenirken/çıkarılırken motor yeniden kuruluyor. */
  reloading: boolean;
}

export type DatasetState = { status: "idle" } | { status: "loading"; name: string } | ReadyDataset | { status: "error"; message: string };

export interface FileEntry {
  file: File;
  displayName?: string;
}

const PREVIEW_ROWS = 100;

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/desteklenmiyor/.test(msg)) return msg;
  return `Dosya okunamadı: ${msg}`;
}

function toInputs(entries: FileEntry[]): TableInput[] {
  const taken: string[] = [];
  return entries.map((entry, i) => {
    const table = i === 0 ? PRIMARY_TABLE : tableNameFromFile(entry.file.name, taken);
    taken.push(table);
    return { file: entry.file, table, displayName: entry.displayName ?? entry.file.name };
  });
}

/** Tüm dosyaları yeni, kilitli bir tarayıcı içi DuckDB örneğine yükler; tablo profilleri ve ilişkileri döndürür. */
async function buildEngine(inputs: TableInput[]) {
  const { DataEngine } = await import("@/lib/data/engine");
  const engine = await DataEngine.create();
  try {
    const tables = await engine.loadTables(inputs);
    const relationships: Relationship[] = [];
    for (const candidate of relationshipCandidates(tables)) {
      const coverage = await engine.joinCoverage(candidate.left, candidate.right);
      if (coverage >= MIN_COVERAGE) relationships.push({ ...candidate, coverage });
    }
    const previews: Record<string, QueryResult> = {};
    for (const t of tables) previews[t.table] = await engine.query(`SELECT * FROM "${t.table}" LIMIT ${PREVIEW_ROWS}`);
    return { engine, tables, relationships, previews };
  } catch (err) {
    await engine.dispose();
    throw err;
  }
}

export function useDataset() {
  const [state, setState] = useState<DatasetState>({ status: "idle" });
  const engineRef = useRef<DataEngine | null>(null);
  const entriesRef = useRef<FileEntry[]>([]);
  const loadId = useRef(0);

  useEffect(() => () => void engineRef.current?.dispose(), []);

  const toReady = (built: Awaited<ReturnType<typeof buildEngine>>): ReadyDataset => ({
    status: "ready",
    profile: built.tables[0],
    tables: built.tables,
    relationships: built.relationships,
    previews: built.previews,
    preview: built.previews[PRIMARY_TABLE],
    sizeBytes: built.tables.reduce((n, t) => n + t.sizeBytes, 0),
    addError: null,
    reloading: false,
  });

  /** Yeni veri seti: ilk dosya ana tablo, varsa diğerleri ek tablolar. */
  const load = useCallback(async (entries: FileEntry[]) => {
    if (entries.length === 0) return;
    const id = ++loadId.current;
    setState({ status: "loading", name: entries[0].displayName ?? entries[0].file.name });
    await engineRef.current?.dispose();
    engineRef.current = null;
    try {
      const limited = entries.slice(0, MAX_EXTRA_TABLES + 1);
      const built = await buildEngine(toInputs(limited));
      if (id !== loadId.current) {
        await built.engine.dispose();
        return;
      }
      engineRef.current = built.engine;
      entriesRef.current = limited;
      setState(toReady(built));
    } catch (err) {
      if (id === loadId.current) setState({ status: "error", message: describeError(err) });
    }
  }, []);

  /**
   * Tablo kümesini değiştirir (ekle/çıkar). Motor kilitli olduğu için tüm dosyalar yeni bir örneğe yeniden yüklenir;
   * başarısız olursa eski motor ve durum korunur, hata `addError` ile gösterilir.
   */
  const replaceEntries = useCallback(async (next: FileEntry[]) => {
    const id = ++loadId.current;
    setState((s) => (s.status === "ready" ? { ...s, reloading: true, addError: null } : s));
    try {
      const built = await buildEngine(toInputs(next));
      if (id !== loadId.current) {
        await built.engine.dispose();
        return;
      }
      const old = engineRef.current;
      engineRef.current = built.engine;
      entriesRef.current = next;
      setState(toReady(built));
      await old?.dispose();
    } catch (err) {
      if (id === loadId.current) {
        setState((s) => (s.status === "ready" ? { ...s, reloading: false, addError: describeError(err) } : s));
      }
    }
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = MAX_EXTRA_TABLES + 1 - entriesRef.current.length;
      if (room <= 0 || files.length === 0) {
        setState((s) => (s.status === "ready" ? { ...s, addError: `En fazla ${MAX_EXTRA_TABLES} ek tablo eklenebilir.` } : s));
        return;
      }
      await replaceEntries([...entriesRef.current, ...files.slice(0, room).map((file) => ({ file }))]);
    },
    [replaceEntries],
  );

  const removeTable = useCallback(
    async (table: string) => {
      const inputs = toInputs(entriesRef.current);
      const index = inputs.findIndex((i) => i.table === table);
      if (index <= 0) return; // ana tablo çıkarılamaz
      await replaceEntries(entriesRef.current.filter((_, i) => i !== index));
    },
    [replaceEntries],
  );

  const reset = useCallback(async () => {
    loadId.current++;
    await engineRef.current?.dispose();
    engineRef.current = null;
    entriesRef.current = [];
    setState({ status: "idle" });
  }, []);

  return { state, load, addFiles, removeTable, reset, engine: engineRef };
}

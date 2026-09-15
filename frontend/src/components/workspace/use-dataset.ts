"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataEngine } from "@/lib/data/engine";
import type { DatasetProfile, QueryResult } from "@/lib/data/types";

export type DatasetState =
  | { status: "idle" }
  | { status: "loading"; name: string }
  | { status: "ready"; profile: DatasetProfile; preview: QueryResult; sizeBytes: number }
  | { status: "error"; message: string };

const PREVIEW_ROWS = 100;

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/desteklenmiyor/.test(msg)) return msg;
  return `Dosya okunamadı: ${msg}`;
}

/** Her yüklemede yeni, kilitli bir tarayıcı içi DuckDB örneği oluşturur. */
export function useDataset() {
  const [state, setState] = useState<DatasetState>({ status: "idle" });
  const engineRef = useRef<DataEngine | null>(null);
  const loadId = useRef(0);

  useEffect(() => () => void engineRef.current?.dispose(), []);

  const load = useCallback(async (file: File, displayName?: string) => {
    const id = ++loadId.current;
    setState({ status: "loading", name: displayName ?? file.name });
    await engineRef.current?.dispose();
    engineRef.current = null;
    try {
      const { DataEngine } = await import("@/lib/data/engine");
      const engine = await DataEngine.create();
      const profile = await engine.load(file, displayName);
      const preview = await engine.query(`SELECT * FROM data LIMIT ${PREVIEW_ROWS}`);
      if (id !== loadId.current) {
        await engine.dispose();
        return;
      }
      engineRef.current = engine;
      setState({ status: "ready", profile, preview, sizeBytes: file.size });
    } catch (err) {
      if (id === loadId.current) setState({ status: "error", message: describeError(err) });
    }
  }, []);

  const reset = useCallback(async () => {
    loadId.current++;
    await engineRef.current?.dispose();
    engineRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, load, reset, engine: engineRef };
}

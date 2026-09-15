"use client";

import { ArrowUpRight, FileUp, LayoutGrid, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { DEMO_DATASETS, fetchDemoFiles, type DemoDataset } from "@/lib/demo";
import type { FileEntry } from "./use-dataset";
import { cn } from "@/lib/utils";

interface Props {
  /** İlk dosya ana tablo olur; birden fazla dosya seçilirse diğerleri ek tablolar olarak yüklenir. */
  onFiles: (entries: FileEntry[]) => void;
  loadingName: string | null;
  error: string | null;
  pinCount: number;
  onOpenBoard: () => void;
}

export function DatasetPicker({ onFiles, loadingName, error, pinCount, onOpenBoard }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const busy = loadingName !== null;

  async function openDemo(demo: DemoDataset) {
    setDemoError(null);
    try {
      const files = await fetchDemoFiles(demo);
      onFiles(files.map((file, i) => ({ file, displayName: i === 0 ? demo.title : undefined })));
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : String(e));
    }
  }

  const shownError = error ?? demoError;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12 sm:py-20">
      <header className="flex flex-col gap-4">
        <h1 className="font-heading text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">
          Verini bırak.
          <br />
          <span className="text-muted-foreground">Sorunu Türkçe sor.</span>
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">
          Dosyan tarayıcında açılır ve orada sorgulanır, hiçbir sunucuya yüklenmez. Yapay zekâ yalnızca{" "}
          <span className="font-medium text-outbound">sütun adlarını ve tiplerini</span> görür.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...e.dataTransfer.files];
          if (files.length && !busy) onFiles(files.map((file) => ({ file })));
        }}
        className={cn(
          "relative flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-card px-6 py-12 text-center transition-colors",
          dragging ? "border-local bg-local-soft" : "border-border",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="size-7 animate-spin text-local" aria-hidden />
            <p className="font-medium" role="status">
              {loadingName} tarayıcında açılıyor…
            </p>
            <p className="text-sm text-muted-foreground">Sütun tipleri ve profil yerelde hesaplanıyor.</p>
          </>
        ) : (
          <>
            <FileUp className="size-7 text-local" aria-hidden />
            <p className="font-medium">Dosyanı buraya sürükle</p>
            <p className="text-sm text-muted-foreground">CSV, Parquet veya Excel (.xlsx) · birden fazla dosya birleştirilebilir</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Dosya seç
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.parquet,.xlsx,.xls"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) onFiles(files.map((file) => ({ file })));
            e.target.value = "";
          }}
        />
      </div>

      {shownError && (
        <p role="alert" className="-mt-6 rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive">
          {shownError}
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="demo-heading">
        <h2 id="demo-heading" className="text-sm font-medium text-muted-foreground">
          Dosyan yoksa hazır bir veri setiyle dene
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {DEMO_DATASETS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              disabled={busy}
              onClick={() => openDemo(demo)}
              className="group flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/30 disabled:opacity-50"
            >
              <span className="flex items-center justify-between gap-2 font-heading text-base font-medium">
                <span className="flex items-center gap-2">
                  {demo.title}
                  {demo.badge && (
                    <span className="rounded bg-local-soft px-1.5 py-0.5 font-sans text-[11px] font-medium text-local">{demo.badge}</span>
                  )}
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
              <span className="text-sm text-muted-foreground">{demo.description}</span>
              <span className="mt-auto pt-2 font-mono text-xs text-foreground/70">“{demo.sample}”</span>
            </button>
          ))}
        </div>
      </section>

      {pinCount > 0 && (
        <button
          type="button"
          onClick={onOpenBoard}
          className="-mt-4 flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <LayoutGrid className="size-4" aria-hidden />
          Panonda {pinCount} sabitlenmiş grafik var
          <ArrowUpRight className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

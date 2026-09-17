"use client";

import { ArrowUpRight, Cpu, Database, FileSpreadsheet, FileUp, HardDrive, LayoutGrid, Layers, Loader2, Lock, ShieldCheck, Sparkles, Terminal, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { DataMorphCanvas } from "@/components/ui/data-morph-canvas";
import { DEMO_DATASETS, fetchDemoFiles, type DemoDataset } from "@/lib/demo";
import type { FileEntry } from "./use-dataset";
import { cn } from "@/lib/utils";

interface Props {
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
    <div className="relative min-h-[calc(100vh-4.5rem)] overflow-hidden flex flex-col justify-center">
      {/* 🎬 Sinematik Veriden Grafiğe Dönüşüm Şovu (Data-to-Chart Morph Canvas) */}
      <DataMorphCanvas />

      {/* Arka Plan Ambient Işık Auraları */}
      <div className="ambient-glow ambient-glow-indigo -top-20 left-1/2 -translate-x-1/2 size-96 sm:size-[40rem] opacity-30 animate-pulse-glow" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center gap-9 px-4 py-12 sm:py-16">
        
        {/* Canlı Veri Motoru Telemetri Şeridi */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 rounded-full border border-border/80 bg-card/80 px-4 py-1.5 text-[11px] font-mono text-muted-foreground backdrop-blur-2xl shadow-sm animate-in fade-in duration-500">
          <span className="flex items-center gap-1.5 text-local font-semibold">
            <span className="size-2 rounded-full bg-local animate-pulse" />
            DUCKDB-WASM OLAP
          </span>
          <span className="text-border">&bull;</span>
          <span className="flex items-center gap-1 text-foreground">
            <Zap className="size-3 text-amber-500" />
            &lt;20ms Bellek-İçi Sorgu
          </span>
          <span className="text-border">&bull;</span>
          <span className="flex items-center gap-1 text-outbound font-medium">
            <ShieldCheck className="size-3" />
            Zero-Data Exposure
          </span>
          <span className="text-border hidden sm:inline">&bull;</span>
          <span className="hidden sm:inline font-mono text-muted-foreground">Apache Arrow &bull; Parquet / CSV</span>
        </div>

        {/* Ana Başlık & Tipografi */}
        <div className="flex flex-col items-center text-center gap-3.5 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-700">
          <h1 className="font-heading text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-6xl bg-gradient-to-b from-foreground via-foreground to-foreground/75 bg-clip-text text-transparent">
            Verinle doğrudan konuş.
            <br />
            <span className="text-muted-foreground font-normal text-3xl sm:text-5xl">Vektörize hızda, tam gizlilikle.</span>
          </h1>
          
          <p className="max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed">
            Tarayıcınızda çalışan <b>DuckDB OLAP</b> motoruyla analitik SQL sorguları koşun. 
            Ham veri satırları asla sunucuya gitmez; yapay zekâya yalnızca <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-outbound-soft text-outbound font-semibold">SCHEMA METADATA</span> iletilir.
          </p>
        </div>

        {/* Bespoke Data Ingestion Lens (Dosya Yükleme Alanı) */}
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
            "group relative flex w-full flex-col items-center gap-4 rounded-3xl border border-border/80 bg-card/65 p-8 sm:p-12 text-center transition-all duration-300 backdrop-blur-2xl shadow-xl",
            dragging
              ? "border-local bg-local-soft/90 scale-[1.01] shadow-2xl shadow-local/20"
              : "hover:border-foreground/35 hover:bg-card/85 hover:shadow-2xl",
            busy && "pointer-events-none opacity-80"
          )}
        >
          {/* Teknik Köşe Artı İşaretleri (Corner Crosshairs) */}
          <span className="absolute -top-1.5 -left-1.5 text-xs font-mono text-muted-foreground/50 select-none">+</span>
          <span className="absolute -top-1.5 -right-1.5 text-xs font-mono text-muted-foreground/50 select-none">+</span>
          <span className="absolute -bottom-1.5 -left-1.5 text-xs font-mono text-muted-foreground/50 select-none">+</span>
          <span className="absolute -bottom-1.5 -right-1.5 text-xs font-mono text-muted-foreground/50 select-none">+</span>

          {busy ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative">
                <Loader2 className="size-10 animate-spin text-local" aria-hidden />
                <div className="absolute inset-0 size-10 animate-ping rounded-full bg-local/20 -z-10" />
              </div>
              <p className="font-heading text-lg font-semibold text-foreground" role="status">
                {loadingName} DuckDB belleğine alınıyor…
              </p>
              <p className="text-xs font-mono text-muted-foreground">Columnar schema analizi &amp; profil çıkarımı yapılıyor.</p>
            </div>
          ) : (
            <>
              <div className="grid size-14 place-items-center rounded-2xl border border-local/30 bg-local-soft/80 text-local shadow-inner transition-transform group-hover:scale-110 duration-300">
                <FileUp className="size-7" aria-hidden />
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="font-heading text-base sm:text-lg font-semibold text-foreground">
                  Veri dosyanızı buraya bırakın veya seçin
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 font-mono text-xs text-muted-foreground">
                  <span className="px-2 py-0.5 rounded-md border border-border/70 bg-panel/80 font-medium">.CSV</span>
                  <span className="px-2 py-0.5 rounded-md border border-border/70 bg-panel/80 font-medium">.PARQUET</span>
                  <span className="px-2 py-0.5 rounded-md border border-border/70 bg-panel/80 font-medium">.XLSX</span>
                  <span className="px-2 py-0.5 rounded-md border border-border/70 bg-panel/80 font-medium">.TSV</span>
                  <span className="text-muted-foreground">&bull; Çoklu Tablo Otomatik JOIN Desteği</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:scale-105 hover:opacity-95 active:scale-95 cursor-pointer"
              >
                <FileSpreadsheet className="size-4" />
                Dosya Yükle
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
          <div role="alert" className="w-full rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive backdrop-blur-md animate-in fade-in">
            {shownError}
          </div>
        )}

        {/* Demo Veri Kartuşları (Data Cartridges) */}
        <section className="flex w-full flex-col gap-4" aria-labelledby="demo-heading">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <h2 id="demo-heading" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2 font-mono">
              <Database className="size-3.5 text-outbound" />
              Hazır Örnek Analitik Veri Kartuşları
            </h2>
            <span className="text-xs font-mono text-muted-foreground hidden sm:inline">DuckDB In-Memory Preloaded</span>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            {DEMO_DATASETS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                disabled={busy}
                onClick={() => openDemo(demo)}
                className="group relative flex flex-col justify-between gap-3 rounded-2xl border border-border/75 bg-card/65 p-4 sm:p-5 text-left backdrop-blur-xl transition-all duration-300 hover:border-foreground/30 hover:bg-card/90 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 cursor-pointer"
              >
                {/* Mikro kılavuz köşeleri */}
                <span className="absolute top-2 right-2 text-[10px] font-mono text-muted-foreground/40 group-hover:text-foreground/70 transition-colors">DATA//SET</span>

                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm sm:text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      {demo.title}
                    </span>
                    {demo.badge && (
                      <span className="rounded-md bg-local-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-local border border-local/20">
                        {demo.badge}
                      </span>
                    )}
                  </div>
                  <div className="grid size-6 place-items-center rounded-lg border bg-panel text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground">
                    <ArrowUpRight className="size-3.5" />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {demo.description}
                </p>

                <div className="rounded-xl bg-panel/80 px-3 py-1.5 font-mono text-[11px] text-muted-foreground group-hover:text-foreground/90 transition-colors border border-border/40">
                  <span className="text-outbound mr-1 font-semibold">&ldquo;</span>
                  {demo.sample}
                  <span className="text-outbound ml-1 font-semibold">&rdquo;</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {pinCount > 0 && (
          <button
            type="button"
            onClick={onOpenBoard}
            className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card/80 px-4 py-2 text-xs font-semibold text-muted-foreground backdrop-blur-md transition-all hover:text-foreground hover:bg-card hover:shadow-md cursor-pointer"
          >
            <LayoutGrid className="size-3.5 text-outbound" aria-hidden />
            Panoda <span className="font-bold text-foreground">{pinCount}</span> sabitlenmiş analiz var
            <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden />
          </button>
        )}

      </div>
    </div>
  );
}

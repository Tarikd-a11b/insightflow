"use client";

import { ArrowUpRight, Database, FileSpreadsheet, FileUp, HardDrive, LayoutGrid, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
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
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sinematik Ambient Işık Efektleri */}
      <div className="ambient-glow ambient-glow-indigo -top-24 left-1/2 -translate-x-1/2 size-96 sm:size-[32rem] opacity-40 animate-pulse-glow" aria-hidden />
      <div className="ambient-glow ambient-glow-emerald top-96 -left-20 size-72 sm:size-96 opacity-30" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center gap-10 px-4 py-12 sm:py-20">
        
        {/* Üst Rozet & Başlık */}
        <div className="flex flex-col items-center text-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="inline-flex items-center gap-2 rounded-full border border-local/30 bg-local-soft/60 px-3 py-1 text-xs font-medium text-local backdrop-blur-md">
            <ShieldCheck className="size-3.5 text-local" aria-hidden />
            <span>%100 Local-First &bull; Sıfır Veri Sızıntısı</span>
          </div>
          
          <h1 className="font-heading text-4xl leading-[1.1] font-bold tracking-tight text-balance sm:text-6xl max-w-2xl bg-gradient-to-b from-foreground via-foreground to-foreground/75 bg-clip-text text-transparent">
            Verinle doğrudan konuş.
            <br />
            <span className="text-muted-foreground font-normal text-3xl sm:text-5xl">Doğal dille, anında içgörü.</span>
          </h1>
          
          <p className="max-w-xl text-sm sm:text-base text-muted-foreground leading-relaxed">
            Dosyanız doğrudan tarayıcınızda açılır ve sorgulanır. 
            Yapay zekâya yalnızca <span className="font-medium text-outbound underline decoration-outbound/30 underline-offset-4">sütun şeması</span> iletilir; verileriniz cihazınızdan asla çıkmaz.
          </p>
        </div>

        {/* Sürükle Bırak / Yükleme Kartı */}
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
            "group relative flex w-full flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all duration-300 backdrop-blur-xl",
            dragging
              ? "border-local bg-local-soft/80 scale-[1.01] shadow-2xl shadow-local/10"
              : "border-border/80 bg-card/60 hover:border-foreground/30 hover:bg-card/80 hover:shadow-xl",
            busy && "pointer-events-none opacity-80"
          )}
        >
          {busy ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative">
                <Loader2 className="size-10 animate-spin text-local" aria-hidden />
                <div className="absolute inset-0 size-10 animate-ping rounded-full bg-local/20 -z-10" />
              </div>
              <p className="font-heading text-lg font-medium text-foreground" role="status">
                {loadingName} hazırlanıyor…
              </p>
              <p className="text-xs text-muted-foreground">In-memory DuckDB motoru ve profil yerelde oluşturuluyor.</p>
            </div>
          ) : (
            <>
              <div className="grid size-14 place-items-center rounded-2xl border border-local/30 bg-local-soft/70 text-local shadow-inner transition-transform group-hover:scale-110 duration-300">
                <FileUp className="size-7" aria-hidden />
              </div>

              <div className="flex flex-col gap-1">
                <p className="font-heading text-base sm:text-lg font-semibold text-foreground">
                  Veri dosyanızı buraya bırakın
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  CSV, Parquet, Excel (.xlsx) &bull; Birden fazla tablo otomatik ilişkilendirilebilir
                </p>
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-1 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:scale-[1.02] hover:opacity-95 active:scale-95 cursor-pointer"
              >
                <FileSpreadsheet className="size-4" />
                Dosya Seç
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
          <div role="alert" className="w-full rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive backdrop-blur-sm animate-in fade-in">
            {shownError}
          </div>
        )}

        {/* Demo Veri Setleri Başlığı & Kartları */}
        <section className="flex w-full flex-col gap-4" aria-labelledby="demo-heading">
          <div className="flex items-center justify-between">
            <h2 id="demo-heading" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-outbound" />
              Hazır Demo Veri Setleriyle Keşfet
            </h2>
            <span className="text-xs text-muted-foreground hidden sm:inline">Kurulum veya kayıt gerekmez</span>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            {DEMO_DATASETS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                disabled={busy}
                onClick={() => openDemo(demo)}
                className="group relative flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-4 text-left backdrop-blur-sm transition-all duration-300 hover:border-foreground/30 hover:bg-card/90 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm sm:text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      {demo.title}
                    </span>
                    {demo.badge && (
                      <span className="rounded-md bg-local-soft/90 px-2 py-0.5 font-mono text-[10px] font-medium text-local border border-local/20">
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

                <div className="rounded-lg bg-panel/70 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground group-hover:text-foreground/90 transition-colors border border-border/40">
                  <span className="text-outbound mr-1">&ldquo;</span>
                  {demo.sample}
                  <span className="text-outbound ml-1">&rdquo;</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {pinCount > 0 && (
          <button
            type="button"
            onClick={onOpenBoard}
            className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card/70 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-md transition-all hover:text-foreground hover:bg-card hover:shadow-md cursor-pointer"
          >
            <LayoutGrid className="size-3.5 text-outbound" aria-hidden />
            Panoda <span className="font-semibold text-foreground">{pinCount}</span> sabitlenmiş analiz var
            <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden />
          </button>
        )}

      </div>
    </div>
  );
}

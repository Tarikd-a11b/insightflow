"use client";

import { ArrowUpRight, Database, FileSpreadsheet, FileUp, LayoutGrid, Loader2, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEMO_DATASETS, DEMO_TOTAL_ROWS, fetchDemoFiles, type DemoDataset } from "@/lib/demo";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataField } from "./data-field";
import type { FileEntry } from "./use-dataset";

interface Props {
  /** İlk dosya ana tablo olur; birden fazla dosya seçilirse diğerleri ek tablolar olarak yüklenir. */
  onFiles: (entries: FileEntry[]) => void;
  loadingName: string | null;
  error: string | null;
  pinCount: number;
  onOpenBoard: () => void;
}

/** Sayı, ilk boyamada hedefine kadar sayar; hareket kısıtlıysa doğrudan hedefte durur. */
function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    setValue(0);
    const step = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export function DatasetPicker({ onFiles, loadingName, error, pinCount, onOpenBoard }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const busy = loadingName !== null;
  const demoRows = useCountUp(DEMO_TOTAL_ROWS);

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
      {/* Kolonsal veri alanı: sağ yarıda akan bloklar, üzerinden geçen tarama ışını. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-full sm:w-[62%]" aria-hidden>
        <DataField className="size-full" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent sm:via-background/55" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:py-16">
        {/* Motor telemetrisi */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both flex items-center gap-1.5 rounded-full border border-local/25 bg-local-soft/60 px-3 py-1 font-semibold text-local duration-500">
            <span className="size-1.5 rounded-full bg-local" />
            DUCKDB-WASM OLAP
          </span>
          <span className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both flex items-center gap-1.5 rounded-full border border-border/80 bg-card/70 px-3 py-1 backdrop-blur-sm delay-75 duration-500">
            <Zap className="size-3" aria-hidden />
            &lt;20 ms bellek-içi sorgu
          </span>
          <span className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both hidden rounded-full border border-border/80 bg-card/70 px-3 py-1 backdrop-blur-sm delay-150 duration-500 sm:inline">
            Apache Arrow · Parquet/CSV
          </span>
          <span className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both flex items-center gap-1.5 rounded-full border border-outbound/30 bg-outbound-soft/70 px-3 py-1 font-medium text-outbound delay-200 duration-500">
            <ShieldCheck className="size-3" aria-hidden />
            Zero-Data Exposure
          </span>
        </div>

        {/* Başlık: soldan hizalı, satır satır açılıyor. */}
        <div className="flex max-w-3xl flex-col gap-5">
          <h1 className="font-heading text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl">
            <span className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both block duration-700">
              Verinle konuş.
            </span>
            <span className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both block delay-100 duration-700">
              Vektörize hızda,
            </span>
            <span className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both block text-local delay-200 duration-700">
              tam gizlilikle.
            </span>
          </h1>

          <p className="animate-in fade-in fill-mode-both max-w-2xl text-sm leading-relaxed text-muted-foreground delay-300 duration-700 sm:text-base">
            Tarayıcınızda çalışan <b className="font-semibold text-foreground">DuckDB OLAP</b> motoruyla analitik SQL
            sorguları koşun. Ham veri satırları asla sunucuya gitmez; yapay zekâya yalnızca{" "}
            <span className="rounded bg-outbound-soft px-1.5 py-0.5 font-mono text-xs font-medium text-outbound">
              SCHEMA METADATA
            </span>{" "}
            iletilir.
          </p>
        </div>

        {/* Bırakma alanı */}
        <div
          ref={dropRef}
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
          onPointerMove={(e) => {
            const node = dropRef.current;
            if (!node) return;
            const rect = node.getBoundingClientRect();
            node.style.setProperty("--pointer-x", `${e.clientX - rect.left}px`);
            node.style.setProperty("--pointer-y", `${e.clientY - rect.top}px`);
          }}
          className={cn(
            "group animate-in fade-in fill-mode-both relative max-w-2xl overflow-hidden rounded-2xl border border-dashed p-6 backdrop-blur-xl transition-all delay-500 duration-300 sm:p-7",
            dragging
              ? "border-local bg-local-soft/70 shadow-2xl shadow-local/10"
              : "border-border/80 bg-card/60 hover:border-local/40 hover:bg-card/80",
            busy && "pointer-events-none opacity-80",
          )}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(420px 140px at var(--pointer-x, 50%) var(--pointer-y, 50%), color-mix(in srgb, var(--local) 12%, transparent), transparent 70%)",
            }}
            aria-hidden
          />

          {busy ? (
            <div className="relative flex items-center gap-4">
              <Loader2 className="size-8 shrink-0 animate-spin text-local" aria-hidden />
              <div className="min-w-0">
                <p className="font-heading text-base font-medium text-foreground" role="status">
                  {loadingName} DuckDB belleğine alınıyor…
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  Kolon şeması çıkarılıyor, profil hesaplanıyor.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative flex flex-wrap items-center gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-local/30 bg-local-soft/70 text-local transition-transform duration-300 group-hover:scale-105">
                <FileUp className="size-6" aria-hidden />
              </div>

              <div className="min-w-0 flex-1 basis-56">
                <p className="font-heading text-base font-semibold text-foreground">
                  Veri dosyanızı buraya bırakın veya seçin
                </p>
                <div className="flex flex-wrap items-center gap-1.5 pt-2 font-mono text-[11px] text-muted-foreground">
                  <span className="rounded border border-border/60 px-1.5 py-0.5">.CSV</span>
                  <span className="rounded border border-border/60 px-1.5 py-0.5">.PARQUET</span>
                  <span className="rounded border border-border/60 px-1.5 py-0.5">.XLSX</span>
                  <span className="rounded border border-border/60 px-1.5 py-0.5">.TSV</span>
                  <span>· çoklu tablo → otomatik JOIN</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:opacity-95 active:translate-y-0"
              >
                <FileSpreadsheet className="size-4" aria-hidden />
                Dosya Seç
              </button>
            </div>
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
          <div
            role="alert"
            className="animate-in fade-in max-w-2xl rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {shownError}
          </div>
        )}

        {/* Ölçüler: iddia değil, sayılabilir olanlar. */}
        <dl className="animate-in fade-in fill-mode-both grid grid-cols-2 border-t border-border/70 delay-700 duration-700 sm:grid-cols-4">
          <div className="border-r border-border/50 py-4 pr-5 last:border-r-0">
            <dt className="sr-only">Bellek-içi sorgu hedefi</dt>
            <dd>
              <span className="font-mono text-2xl font-medium tracking-tight text-foreground tabular-nums sm:text-3xl">
                &lt;20 ms
              </span>
              <span className="mt-2 block text-xs leading-snug text-muted-foreground">
                bellek-içi sorgu — ağ turu yok
              </span>
            </dd>
          </div>
          <div className="py-4 pr-5 sm:border-r sm:border-border/50">
            <dt className="sr-only">Sunucuya giden ham kayıt</dt>
            <dd>
              <span className="font-mono text-2xl font-medium tracking-tight text-local tabular-nums sm:text-3xl">
                0 satır
              </span>
              <span className="mt-2 block text-xs leading-snug text-muted-foreground">
                sunucuya giden ham kayıt
              </span>
            </dd>
          </div>
          <div className="border-r border-border/50 border-t sm:border-t-0 py-4 pr-5">
            <dt className="sr-only">Desteklenen biçim</dt>
            <dd>
              <span className="font-mono text-2xl font-medium tracking-tight text-foreground tabular-nums sm:text-3xl">
                4 biçim
              </span>
              <span className="mt-2 block text-xs leading-snug text-muted-foreground">
                CSV, Parquet, XLSX, TSV — tarayıcıda ayrıştırılır
              </span>
            </dd>
          </div>
          <div className="border-t border-border/50 py-4 pr-5 sm:border-t-0">
            <dt className="sr-only">Hazır örnek veri</dt>
            <dd>
              <span className="font-mono text-2xl font-medium tracking-tight text-foreground tabular-nums sm:text-3xl">
                {formatInt(demoRows)}
              </span>
              <span className="mt-2 block text-xs leading-snug text-muted-foreground">
                satır hazır örnek veri — tek tıkla yüklenir
              </span>
            </dd>
          </div>
        </dl>

        {/* Hazır veri setleri */}
        <section className="flex w-full flex-col gap-4" aria-labelledby="demo-heading">
          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
            <h2
              id="demo-heading"
              className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <Database className="size-3.5 text-outbound" aria-hidden />
              Hazır örnek analitik veri setleri
            </h2>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              DuckDB belleğine doğrudan yüklenir
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {DEMO_DATASETS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                disabled={busy}
                onClick={() => openDemo(demo)}
                className="group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border border-border/70 bg-card/60 p-4 text-left backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-local/40 hover:bg-card/90 hover:shadow-lg disabled:pointer-events-none disabled:opacity-50"
              >
                <span
                  className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-local transition-transform duration-300 group-hover:scale-y-100"
                  aria-hidden
                />

                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-base font-semibold text-foreground">{demo.title}</span>
                    {demo.badge && (
                      <span className="rounded-md border border-outbound/25 bg-outbound-soft/90 px-2 py-0.5 font-mono text-[10px] font-medium text-outbound">
                        {demo.badge}
                      </span>
                    )}
                  </div>
                  <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-border/60 bg-panel text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground">
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-muted-foreground">{demo.description}</p>

                <p className="font-mono text-[11px] text-outbound/90 transition-transform duration-300 group-hover:translate-x-0.5">
                  &ldquo;{demo.sample}&rdquo;
                </p>

                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-3 font-mono text-[11px] text-muted-foreground">
                  <span>
                    <b className="font-medium text-foreground tabular-nums">{formatInt(demo.rows)}</b> satır
                  </span>
                  <span>
                    <b className="font-medium text-foreground tabular-nums">{demo.columns}</b> kolon
                  </span>
                  <span>{demo.format}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {pinCount > 0 && (
          <button
            type="button"
            onClick={onOpenBoard}
            className="inline-flex cursor-pointer items-center gap-2 self-start rounded-xl border border-border/80 bg-card/70 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-md transition-all hover:bg-card hover:text-foreground hover:shadow-md"
          >
            <LayoutGrid className="size-3.5 text-outbound" aria-hidden />
            Panoda <span className="font-semibold text-foreground">{pinCount}</span> sabitlenmiş analiz var
            <ArrowUpRight className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

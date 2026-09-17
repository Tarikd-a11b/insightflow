"use client";

import { Columns2, Edit3, FileDown, FileText, LayoutGrid, Loader2, Rows, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { pinStore, type Pin } from "@/lib/pins";
import { cn } from "@/lib/utils";
import { ResultView } from "./result-view";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Pinboard({ pins, unavailable }: { pins: Pin[] | null; unavailable: boolean }) {
  const [dashboardTitle, setDashboardTitle] = useState("InsightFlow Yönetici Kokpiti");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [executiveNote, setExecutiveNote] = useState("");
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [layout, setLayout] = useState<"grid" | "stack">("grid");

  if (unavailable) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
        Pano bu tarayıcıda kullanılamıyor: site verisi saklama kapalı veya gizli pencerede olabilirsin.
      </p>
    );
  }
  if (pins === null) return null;
  if (pins.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
        <LayoutGrid className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-medium">Panon boş</p>
        <p className="text-sm text-muted-foreground">
          Bir yanıtın altındaki <span className="font-medium text-foreground">Panoya sabitle</span> ile grafikleri burada
          topla veya <span className="font-medium text-outbound">&ldquo;Dashboard Hazırla&rdquo;</span> ile AI&apos;ın otomatik kokpit kurmasını sağla.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Dashboard Üst Başlık & Kontroller (Customizable Dashboard Header) */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-panel/70 p-4 sm:p-5 backdrop-blur-md shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isEditingTitle ? (
              <input
                type="text"
                value={dashboardTitle}
                onChange={(e) => setDashboardTitle(e.target.value)}
                onBlur={() => setIsEditingTitle(false)}
                onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
                autoFocus
                className="rounded-lg border border-outbound bg-card px-2.5 py-1 text-lg font-bold text-foreground font-heading focus:outline-none focus:ring-2 focus:ring-outbound/30"
              />
            ) : (
              <div className="group flex items-center gap-2">
                <h2 className="text-xl font-bold font-heading text-foreground tracking-tight">{dashboardTitle}</h2>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  className="rounded-md p-1 text-muted-foreground opacity-70 hover:bg-card hover:text-foreground hover:opacity-100 transition-opacity cursor-pointer"
                  title="Başlığı Düzenle"
                >
                  <Edit3 className="size-3.5" />
                </button>
              </div>
            )}
            <span className="rounded-full bg-outbound-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold text-outbound">
              {pins.length} Grafik
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Düzen Seçici (Layout Toggle) */}
            <div className="flex rounded-lg border border-border/70 bg-card/60 p-0.5 text-xs shadow-xs">
              <button
                type="button"
                onClick={() => setLayout("grid")}
                aria-pressed={layout === "grid"}
                title="2 Sütunlu Izgara"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer",
                  layout === "grid" ? "bg-panel text-foreground font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Columns2 className="size-3.5" />
                <span className="hidden sm:inline">Izgara (2x)</span>
              </button>
              <button
                type="button"
                onClick={() => setLayout("stack")}
                aria-pressed={layout === "stack"}
                title="Tek Sütun Geniş Akış"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer",
                  layout === "stack" ? "bg-panel text-foreground font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Rows className="size-3.5" />
                <span className="hidden sm:inline">Geniş (1x)</span>
              </button>
            </div>

            {/* Yönetici Notu Butonu */}
            <button
              type="button"
              onClick={() => setShowNoteEditor(!showNoteEditor)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                showNoteEditor || executiveNote
                  ? "border-outbound/40 bg-outbound-soft/60 text-outbound"
                  : "border-border/70 bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <FileText className="size-3.5" />
              <span>{executiveNote ? "Notu Düzenle" : "Yönetici Notu Ekle"}</span>
            </button>

            {/* PDF İndirme Butonu */}
            <ReportButton pins={pins} title={dashboardTitle} note={executiveNote} />
          </div>
        </div>

        {/* Yönetici Notu Düzenleyici (Executive Note Editor) */}
        {showNoteEditor && (
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-outbound/30 bg-card/60 p-3 animate-in fade-in">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span className="flex items-center gap-1 text-outbound font-medium">
                <Sparkles className="size-3" />
                Yönetici Notu & Rapor Açıklaması (PDF Rapor kapağına eklenir)
              </span>
              <button
                type="button"
                onClick={() => setShowNoteEditor(false)}
                className="text-xs hover:text-foreground cursor-pointer"
              >
                Kapat
              </button>
            </div>
            <textarea
              rows={2}
              value={executiveNote}
              onChange={(e) => setExecutiveNote(e.target.value)}
              placeholder="Örn: Bu kokpit 2026 Q3 çeyreğinde gerçekleşen satış trendlerini, en karlı bölgeleri ve müşteri risk oranlarını özetlemektedir."
              className="w-full rounded-lg border border-border/80 bg-background/80 p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-outbound focus:outline-none focus:ring-1 focus:ring-outbound"
            />
          </div>
        )}
      </div>

      {/* Pin Kartları Izgarası (Custom Layout Grid) */}
      <ul className={cn("grid gap-4 transition-all", layout === "grid" ? "xl:grid-cols-2" : "grid-cols-1")}>
        {pins.map((pin) => (
          <li
            key={pin.id}
            className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-panel/90 p-4 sm:p-5 backdrop-blur-md transition-all shadow-xs animate-in fade-in"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="font-heading leading-snug font-semibold text-foreground text-base">{pin.question}</h3>
                <p className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                  <span className="font-medium text-foreground/80">{pin.datasetName}</span>
                  <span>&bull;</span>
                  <span>{dateFmt.format(pin.createdAt)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void pinStore.remove(pin.id)}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                aria-label={`"${pin.question}" grafiğini panodan kaldır`}
                title="Panodan Kaldır"
              >
                <X className="size-4" />
              </button>
            </div>

            <ResultView result={pin.result} chart={pin.chart} chartHeight={pin.chart === "bar" ? undefined : layout === "stack" ? 280 : 230} tableClassName="max-h-64" />

            {pin.summary && (
              <div className="rounded-xl border border-outbound/20 bg-outbound-soft/30 p-3 text-xs leading-relaxed text-foreground">
                <span className="font-mono font-semibold text-outbound text-[10px] uppercase block mb-1">
                  Yönetici İçgörüsü:
                </span>
                {pin.summary}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Panodaki tüm analizleri tek PDF'te toplar; başlık ve yönetici notunu rapora aktarır. */
function ReportButton({ pins, title, note }: { pins: Pin[]; title: string; note?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function download() {
    setState("busy");
    try {
      const { downloadReport } = await import("@/lib/report");
      await downloadReport([...pins].sort((a, b) => a.createdAt - b.createdAt), {
        title,
        note: note?.trim() || undefined,
      });
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {state === "error" && <span className="text-xs text-destructive">Rapor oluşturulamadı.</span>}
      <button
        type="button"
        onClick={() => void download()}
        disabled={state === "busy"}
        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-60 cursor-pointer"
      >
        {state === "busy" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
        {state === "busy" ? "PDF Hazırlanıyor…" : "Raporu İndir (PDF)"}
      </button>
    </div>
  );
}

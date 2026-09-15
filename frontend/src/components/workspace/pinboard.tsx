"use client";

import { FileDown, LayoutGrid, Loader2, X } from "lucide-react";
import { useState } from "react";
import { pinStore, type Pin } from "@/lib/pins";
import { ResultView } from "./result-view";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Pinboard({ pins, unavailable }: { pins: Pin[] | null; unavailable: boolean }) {
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
          topla. Pano yalnızca bu tarayıcıda saklanır.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{pins.length} analiz · pano yalnızca bu tarayıcıda saklanır</p>
        <ReportButton pins={pins} />
      </div>
      <ul className="grid gap-4 xl:grid-cols-2">
        {pins.map((pin) => (
          <li key={pin.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-panel p-4 animate-in fade-in">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 className="font-heading leading-snug font-medium">{pin.question}</h3>
                <p className="text-xs text-muted-foreground">
                  {pin.datasetName} · {dateFmt.format(pin.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void pinStore.remove(pin.id)}
                className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`"${pin.question}" grafiğini panodan kaldır`}
              >
                <X className="size-4" />
              </button>
            </div>
            <ResultView result={pin.result} chart={pin.chart} chartHeight={pin.chart === "bar" ? undefined : 220} tableClassName="max-h-64" />
            {pin.summary && (
              <p className="border-l-2 border-outbound pl-3 text-sm leading-relaxed">{pin.summary}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Panodaki tüm analizleri tek PDF'te toplar; en eski analiz ilk sırada (panodaki gösterimin tersi). */
function ReportButton({ pins }: { pins: Pin[] }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function download() {
    setState("busy");
    try {
      const { downloadReport } = await import("@/lib/report");
      await downloadReport([...pins].sort((a, b) => a.createdAt - b.createdAt));
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
        className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {state === "busy" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
        {state === "busy" ? "Rapor hazırlanıyor…" : "Raporu indir (PDF)"}
      </button>
    </div>
  );
}

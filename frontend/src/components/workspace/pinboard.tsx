"use client";

import { LayoutGrid, X } from "lucide-react";
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
        </li>
      ))}
    </ul>
  );
}

"use client";

import { Cpu, HardDrive, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { OutboundEntry, OutboundKind } from "@/lib/outbound-log";
import { totals } from "@/lib/outbound-log";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<OutboundKind, string> = {
  sql: "Soru → SQL",
  repair: "Hata onarımı",
  summary: "Yönetici özeti",
};

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function statusText(status: number | null): string {
  if (status === null) return "yanıt bekleniyor";
  if (status === 0) return "ağ hatası";
  return status < 400 ? `${status}` : `${status} · reddedildi`;
}

/**
 * "Modele ne gitti?" Bu oturumda sunucuya giden her gövde, gönderildiği hâliyle. Uygulamanın gizlilik
 * iddiasının kanıtı: dosyanın bir satırı burada yoksa, hiçbir sunucuya da gitmemiştir.
 */
export function OutboundPanel({
  open,
  onClose,
  entries,
  rowCount,
}: {
  open: boolean;
  onClose: () => void;
  entries: OutboundEntry[];
  rowCount: number | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const t = totals(entries);
  const newestFirst = [...entries].reverse();

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="outbound-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl bg-panel p-0 text-foreground backdrop:bg-black/40 open:animate-in open:slide-in-from-right-8 open:fade-in"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id="outbound-title" className="font-heading text-xl font-medium">
              Modele ne gitti?
            </h2>
            <p className="text-sm text-muted-foreground">
              Bu oturumda sunucuya gönderilen her istek, gönderildiği hâliyle. Dosyandaki bir kayıt burada yoksa hiçbir
              sunucuya da gitmemiştir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Paneli kapat"
            autoFocus
          >
            <X className="size-4" />
          </button>
        </header>

        <dl className="grid grid-cols-2 border-b text-sm">
          <div className="flex flex-col gap-1 border-r px-5 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HardDrive className="size-3.5 text-local" aria-hidden />
              Cihazında kalan
            </dt>
            <dd className="font-mono text-local">{rowCount === null ? "veri seti yok" : `${formatInt(rowCount)} satır`}</dd>
          </div>
          <div className="flex flex-col gap-1 px-5 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="size-3.5 text-outbound" aria-hidden />
              Modele giden
            </dt>
            <dd className="font-mono text-outbound">
              {t.requests === 0
                ? "hiçbir şey"
                : `${t.columns} sütun adı${t.summaryRows > 0 ? ` · ${t.summaryRows} özet satırı` : ""} · ${t.requests} istek`}
            </dd>
          </div>
        </dl>

        <ol className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
          {newestFirst.length === 0 && (
            <li className="py-10 text-center text-sm text-muted-foreground">
              Henüz hiçbir istek gönderilmedi. Bir soru sorduğunda gönderilen içerik burada görünecek.
            </li>
          )}
          {newestFirst.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-medium",
                    entry.kind === "summary" ? "bg-outbound text-white dark:text-background" : "bg-outbound-soft text-outbound",
                  )}
                >
                  {KIND_LABEL[entry.kind]}
                </span>
                <span className="font-mono text-muted-foreground">{timeFmt.format(entry.at)}</span>
                <span className="ml-auto font-mono text-muted-foreground">{statusText(entry.status)}</span>
              </div>
              {typeof entry.body.question === "string" && <p className="text-sm">{entry.body.question}</p>}
              {entry.kind === "summary" && Array.isArray(entry.body.rows) && (
                <p className="text-xs text-outbound">
                  Onayınla {entry.body.rows.length} satırlık toplu sonuç gönderildi.
                </p>
              )}
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
                  Gönderilen gövdenin tamamı ({formatInt(JSON.stringify(entry.body).length)} karakter)
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-panel p-2 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(entry.body, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </dialog>
  );
}

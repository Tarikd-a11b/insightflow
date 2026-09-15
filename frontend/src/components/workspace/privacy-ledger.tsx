import { Cpu, HardDrive } from "lucide-react";
import type { OutboundTotals } from "@/lib/outbound-log";
import { formatInt } from "@/lib/format";

/**
 * Uygulamanın imzası: cihaz sınırının iki yakası. Solda tarayıcıda kalan veri, sağda yapay zekâya
 * şimdiye kadar giden bilgi. Sağ taraf giden istek kaydından türetilir; tıklayınca gövdelerin kendisi açılır.
 */
export function PrivacyLedger({
  rowCount,
  sent,
  onOpen,
}: {
  rowCount: number | null;
  sent: OutboundTotals;
  onOpen: () => void;
}) {
  const local = rowCount === null ? "veri yok" : `${formatInt(rowCount)} satır`;
  const outbound =
    sent.requests === 0
      ? "hiçbir şey"
      : `${sent.columns} sütun adı${sent.sampleValues > 0 ? ` + ${sent.sampleValues} örnek değer` : ""}${sent.summaryRows > 0 ? ` + ${sent.summaryRows} özet satırı` : ""}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-ledger
      className="flex items-stretch overflow-hidden rounded-md border bg-card text-left text-xs transition-colors hover:border-foreground/30"
      aria-label={`Veri sınırı: cihazında ${local}, modele giden ${outbound}. Gönderilenleri göster.`}
    >
      <span className="flex items-center gap-2 px-3 py-1.5">
        <HardDrive className="size-3.5 text-local" aria-hidden />
        <span className="hidden text-muted-foreground sm:inline">Cihazında</span>
        <span className="font-mono font-medium whitespace-nowrap text-local">{local}</span>
      </span>
      <span className="relative w-px bg-border" aria-hidden>
        <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border bg-background" />
      </span>
      <span className="flex items-center gap-2 px-3 py-1.5">
        <Cpu className="size-3.5 text-outbound" aria-hidden />
        <span className="hidden text-muted-foreground sm:inline">Modele giden</span>
        <span className="font-mono font-medium whitespace-nowrap text-outbound">{outbound}</span>
      </span>
    </button>
  );
}

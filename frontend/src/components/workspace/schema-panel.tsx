import { Calendar, CircleHelp, Hash, KeyRound, ToggleLeft, Type } from "lucide-react";
import type { ColumnKind, ColumnProfile, DatasetProfile } from "@/lib/data/types";
import { formatInt } from "@/lib/format";

const KIND_ICON: Record<ColumnKind, typeof Hash> = {
  numeric: Hash,
  temporal: Calendar,
  boolean: ToggleLeft,
  text: Type,
  other: CircleHelp,
};

const KIND_LABEL: Record<ColumnKind, string> = {
  numeric: "Sayı",
  temporal: "Tarih",
  boolean: "Evet/hayır",
  text: "Metin",
  other: "Diğer",
};

function describe(c: ColumnProfile): string {
  if (c.identifier) return "kimlik";
  if (c.kind === "numeric" || c.kind === "temporal") {
    return c.min !== null && c.max !== null ? `${shorten(c.min)} – ${shorten(c.max)}` : "";
  }
  return `${formatInt(c.distinct)} farklı değer`;
}

function shorten(v: string): string {
  // Zaman damgalarında saat kısmı listede gürültü yapar.
  const s = /^\d{4}-\d{2}-\d{2}[ T]00:00:00/.test(v) ? v.slice(0, 10) : v;
  const n = Number(s);
  if (s.trim() !== "" && Number.isFinite(n)) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, notation: Math.abs(n) >= 1e6 ? "compact" : "standard" }).format(n);
  }
  return s.length > 18 ? `${s.slice(0, 17)}…` : s;
}

export function SchemaPanel({ profile }: { profile: DatasetProfile }) {
  return (
    <section aria-labelledby="schema-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="schema-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Sütunlar
        </h2>
        <span className="font-mono text-xs text-muted-foreground">{profile.columns.length}</span>
      </div>
      <ul className="flex flex-col">
        {profile.columns.map((c) => {
          const Icon = c.identifier ? KeyRound : KIND_ICON[c.kind];
          return (
            <li key={c.name} className="group flex flex-col gap-1 border-b border-border/60 py-2 last:border-0">
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={c.identifier ? "Kimlik" : KIND_LABEL[c.kind]} />
                <span className="truncate font-mono text-[13px]" title={c.name}>
                  {c.name}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground" title={c.type}>
                  {c.type.toLowerCase().replace(/\(.*\)/, "")}
                </span>
              </div>
              <div className="flex items-center gap-2 pl-5.5">
                <span className="truncate text-xs text-muted-foreground">{describe(c)}</span>
                <NullMeter percent={c.nullPercent} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NullMeter({ percent }: { percent: number }) {
  const filled = 100 - percent;
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1.5"
      title={`%${percent.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} boş`}
    >
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full rounded-full bg-local" style={{ width: `${filled}%` }} />
      </span>
      <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">
        {percent === 0 ? "dolu" : `%${Math.round(percent)} boş`}
      </span>
    </span>
  );
}

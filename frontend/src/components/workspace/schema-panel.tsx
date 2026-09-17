"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnKind, ColumnProfile, DatasetProfile } from "@/lib/data/types";
import { formatInt } from "@/lib/format";

const KIND_BADGE: Record<ColumnKind, { label: string; class: string }> = {
  numeric: { label: "NUM", class: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  temporal: { label: "DATE", class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  boolean: { label: "BOOL", class: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  text: { label: "STR", class: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  other: { label: "ANY", class: "bg-muted text-muted-foreground border-border" },
};

function describe(c: ColumnProfile): string {
  if (c.identifier) return "Benzersiz Anahtar (PK)";
  if (c.kind === "numeric" || c.kind === "temporal") {
    return c.min !== null && c.max !== null ? `${shorten(c.min)} &rarr; ${shorten(c.max)}` : "";
  }
  return `${formatInt(c.distinct)} kardinalite`;
}

function shorten(v: string): string {
  const s = /^\d{4}-\d{2}-\d{2}[ T]00:00:00/.test(v) ? v.slice(0, 10) : v;
  const n = Number(s);
  if (s.trim() !== "" && Number.isFinite(n)) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, notation: Math.abs(n) >= 1e6 ? "compact" : "standard" }).format(n);
  }
  return s.length > 14 ? `${s.slice(0, 13)}…` : s;
}

export function SchemaPanel({ profile }: { profile: DatasetProfile }) {
  const [query, setQuery] = useState("");

  const filteredColumns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profile.columns;
    return profile.columns.filter(
      (c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q) || c.kind.toLowerCase().includes(q)
    );
  }, [profile.columns, query]);

  return (
    <section aria-labelledby="schema-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="schema-heading" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5 font-mono">
          <span>Şema ve Sütun Profili</span>
        </h2>
        <span className="font-mono text-xs text-muted-foreground bg-panel px-2 py-0.5 rounded border border-border/60">
          {profile.columns.length} Sütun
        </span>
      </div>

      {/* Sütun Arama Input'u */}
      {profile.columns.length > 5 && (
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sütun veya tip ara…"
            className="w-full rounded-lg border border-border/70 bg-card/60 pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-outbound/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-1.5 max-h-[360px] overflow-y-auto pr-1">
        {filteredColumns.map((c) => {
          const badge = c.identifier
            ? { label: "PK", class: "bg-amber-500/10 text-amber-500 border-amber-500/30 font-bold" }
            : KIND_BADGE[c.kind];

          return (
            <li
              key={c.name}
              className="group flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card/50 p-2.5 transition-all hover:border-foreground/30 hover:bg-card hover:shadow-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold border ${badge.class}`}
                  title={c.type}
                >
                  {badge.label}
                </span>

                <span className="truncate font-mono text-xs font-medium text-foreground" title={c.name}>
                  {c.name}
                </span>

                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {c.type.toLowerCase().replace(/\(.*\)/, "")}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground border-t border-border/30 pt-1">
                <span
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: describe(c) }}
                />
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
      className="flex shrink-0 items-center gap-1.5"
      title={`%${percent.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} null/boş`}
    >
      <span className="h-1 w-8 overflow-hidden rounded-full bg-muted border border-border/40" aria-hidden>
        <span className="block h-full rounded-full bg-local" style={{ width: `${filled}%` }} />
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {percent === 0 ? "100% Dolu" : `%${Math.round(percent)} Boş`}
      </span>
    </span>
  );
}

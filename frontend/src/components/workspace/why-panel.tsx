"use client";

import { AlertTriangle, Compass, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { QueryResult, TableProfile } from "@/lib/data/types";
import { humanize } from "@/lib/chart-spec";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { explainChange, fmtChange, fmtDelta, fmtNum, periodLabel, type DimBreakdown, type Segment, type WhyOutcome, type WhyRunner, type WhyTarget } from "@/lib/why";

/** Yanıt kartına "Neden değişti?" analizi için motordan gelenler. */
export interface WhyContext {
  runner: WhyRunner;
  tables: TableProfile[];
}

const MAX_BARS = 6;

/** İki dönem arasındaki değişimi kategorilere böler; tamamen tarayıcıda, model çağrısı olmadan. */
export function WhyPanel({ sql, result, target, context }: { sql: string; result: QueryResult; target: WhyTarget; context: WhyContext }) {
  const { periods, timeCol, valueCols } = target;
  const [valueCol, setValueCol] = useState(valueCols[0]);
  const [from, setFrom] = useState(periods[periods.length - 2]);
  const [to, setTo] = useState(periods[periods.length - 1]);
  // Sonuç ve seçili kırılım, hesaplandıkları seçime bağlı tutulur; seçim değişince eskisi gösterilmez.
  const key = `${valueCol}|${from}|${to}`;
  const [done, setDone] = useState<{ key: string; outcome: WhyOutcome } | null>(null);
  const [dim, setDim] = useState<{ key: string; index: number } | null>(null);
  const outcome = done?.key === key ? done.outcome : null;
  const dimIndex = dim?.key === key ? dim.index : 0;
  const setDimIndex = (index: number) => setDim({ key, index });

  useEffect(() => {
    let cancelled = false;
    void explainChange(context.runner, { sql, result, timeCol, valueCol, from, to, tables: context.tables })
      .catch((): WhyOutcome => ({ ok: false, reason: "Analiz çalıştırılamadı." }))
      .then((out) => !cancelled && setDone({ key: `${valueCol}|${from}|${to}`, outcome: out }));
    return () => {
      cancelled = true;
    };
  }, [context, sql, result, timeCol, valueCol, from, to]);

  const label = (p: string) => periodLabel(p, periods);
  const selectClass = "rounded-md border border-border/70 bg-card px-2 py-1 text-xs text-foreground";

  return (
    <section aria-label="Neden değişti analizi" className="flex flex-col gap-3 rounded-2xl border border-local/30 bg-card/60 p-4 shadow-xs backdrop-blur-sm animate-in fade-in">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-local">
          <Compass className="size-3.5" aria-hidden />
          Değişim Analizi &bull; Model Kullanılmadı
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {valueCols.length > 1 && (
            <select aria-label="Ölçü" value={valueCol} onChange={(e) => setValueCol(e.target.value)} className={selectClass}>
              {valueCols.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Başlangıç dönemi" value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass}>
            {periods.filter((p) => p < to).map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
          <span aria-hidden>→</span>
          <select aria-label="Bitiş dönemi" value={to} onChange={(e) => setTo(e.target.value)} className={selectClass}>
            {periods.filter((p) => p > from).map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {!outcome && (
        <p role="status" className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin text-local" aria-hidden />
          Değişim kategorilere bölünüyor…
        </p>
      )}

      {outcome && !outcome.ok && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {outcome.reason}
        </p>
      )}

      {outcome?.ok && (
        <>
          <div className="flex flex-col gap-1 text-sm leading-relaxed">
            <p className="font-medium text-foreground">{outcome.story.headline}</p>
            {outcome.story.details.map((d) => (
              <p key={d} className="text-foreground/85">
                {d}
              </p>
            ))}
          </div>

          {outcome.after !== outcome.before && (
            <>
              <div role="tablist" aria-label="Kırılım" className="flex flex-wrap gap-1">
                {outcome.breakdowns.map((b, i) => (
                  <button
                    key={b.dim}
                    type="button"
                    role="tab"
                    aria-selected={i === dimIndex}
                    onClick={() => setDimIndex(i)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs transition-all cursor-pointer",
                      i === dimIndex ? "border-foreground/30 bg-secondary font-semibold text-foreground" : "border-border/70 bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {humanize(b.dim)}
                  </button>
                ))}
              </div>
              <ContributionBars breakdown={outcome.breakdowns[dimIndex] ?? outcome.breakdowns[0]} total={outcome.after - outcome.before} />
            </>
          )}

          <p className="font-mono text-[11px] text-muted-foreground">
            {formatInt(outcome.breakdowns.length)} kırılım tarayıcıda hesaplandı &bull; {formatInt(outcome.ms)} ms &bull; toplamlar orijinal sonuçla doğrulandı
          </p>
        </>
      )}
    </section>
  );
}

/** Her değerin değişime katkısı: ortadan sağa artış, sola düşüş. */
function ContributionBars({ breakdown, total }: { breakdown: DimBreakdown; total: number }) {
  const shown = useMemo<Segment[]>(() => {
    const head = breakdown.segments.slice(0, MAX_BARS);
    const rest = breakdown.segments.slice(MAX_BARS);
    if (rest.length === 0) return head;
    const sum = (k: "before" | "after" | "delta") => rest.reduce((a, s) => a + s[k], 0);
    return [...head, { key: `Diğer ${rest.length} değer`, before: sum("before"), after: sum("after"), delta: sum("delta") }];
  }, [breakdown]);
  const max = Math.max(...shown.map((s) => Math.abs(s.delta)), 1e-9);

  return (
    <ul className="flex flex-col gap-1.5" aria-label={`${humanize(breakdown.dim)} kırılımında katkılar`}>
      {shown.map((s) => {
        const width = `${(Math.abs(s.delta) / max) * 50}%`;
        const up = s.delta >= 0;
        const sharePct = total !== 0 ? Math.round((s.delta / total) * 100) : 0;
        return (
          <li key={s.key} className="grid grid-cols-[minmax(0,6rem)_1fr_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
            <span className="truncate text-foreground" title={s.key}>
              {s.key}
            </span>
            <span className="relative h-4 rounded bg-muted/50" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <span
                className={cn("absolute inset-y-0.5 rounded-sm", up ? "left-1/2 bg-emerald-500/80" : "right-1/2 bg-rose-500/80")}
                style={{ width }}
              />
            </span>
            <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">
              <span className={cn("font-semibold", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{fmtDelta(s.delta)}</span>{" "}
              <span className="hidden sm:inline">
                ({fmtNum(s.before)} → {fmtNum(s.after)}, {fmtChange(s.before, s.after)}
                {total !== 0 && <>; değişimin %{sharePct}</>})
              </span>
              {total !== 0 && <span className="sm:hidden">%{sharePct}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

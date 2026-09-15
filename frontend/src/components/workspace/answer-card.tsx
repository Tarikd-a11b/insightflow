"use client";

import { AlertTriangle, BarChart3, Check, ChevronRight, Copy, FileDown, Loader2, Pin, PinOff, SearchX, Sparkles, Table2, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, requestSummary, summaryPayload } from "@/lib/api";
import type { AskOutcome, AskStep } from "@/lib/ask";
import { formatInt } from "@/lib/format";
import { pinStore } from "@/lib/pins";
import type { ReportItem } from "@/lib/report";
import { cn } from "@/lib/utils";
import { hasChart, ResultView } from "./result-view";

export interface Turn {
  id: number;
  question: string;
  step: AskStep | null;
  outcome: AskOutcome | null;
}

type Answer = Extract<AskOutcome, { kind: "answer" }>;

const STEP_TEXT: Record<AskStep["kind"], string> = {
  writing: "Sorgu yazılıyor…",
  running: "Tarayıcında çalıştırılıyor…",
  repairing: "Hata onarılıyor…",
};

function stepText(step: AskStep): string {
  return step.kind === "repairing" ? `Hata onarılıyor (${step.attempt}/3)…` : STEP_TEXT[step.kind];
}

export function AnswerCard({ turn, datasetName, onStop }: { turn: Turn; datasetName: string; onStop: () => void }) {
  const { outcome } = turn;
  return (
    <article className="flex flex-col gap-3 border-b pb-6 duration-300 animate-in fade-in slide-in-from-bottom-1 last:border-0">
      <h3 className="font-heading text-lg leading-snug font-medium">{turn.question}</h3>

      {!outcome && turn.step && (
        <div className="flex items-center gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-outbound" aria-hidden />
            {stepText(turn.step)}
          </p>
          <button
            type="button"
            onClick={onStop}
            className="rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Durdur
          </button>
        </div>
      )}

      {outcome?.kind === "unanswerable" && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <SearchX className="mt-0.5 size-4 shrink-0" aria-hidden />
          {outcome.reason}
        </p>
      )}

      {outcome?.kind === "failed" && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {outcome.message}
          </p>
          {outcome.lastSql && <SqlPeek sql={outcome.lastSql} />}
        </div>
      )}

      {outcome?.kind === "answer" && <AnswerBody question={turn.question} answer={outcome} datasetName={datasetName} />}
    </article>
  );
}

function AnswerBody({ question, answer, datasetName }: { question: string; answer: Answer; datasetName: string }) {
  const chartable = useMemo(() => hasChart(answer.chart, answer.result), [answer]);
  const [view, setView] = useState<"chart" | "table">(chartable ? "chart" : "table");
  const [pinId, setPinId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | undefined>(undefined);
  const empty = answer.result.rows.length === 0;

  function onSummary(text: string) {
    setSummary(text);
    // Yanıt önce sabitlenip özet sonra çıkarıldıysa panodaki kayıt da özetle güncellenir.
    if (pinId) void pinStore.update(pinId, { summary: text }).catch(() => {});
  }

  return (
    <>
      <p className="text-sm">{answer.explanation}</p>

      {empty ? (
        <p className="text-sm text-muted-foreground">Sorgu çalıştı ama koşula uyan kayıt yok. Filtreyi genişletmeyi dene.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {chartable && (
              <div role="tablist" aria-label="Sonuç görünümü" className="flex gap-1 rounded-md border bg-card p-0.5 text-xs">
                {(
                  [
                    ["chart", "Grafik", BarChart3],
                    ["table", "Tablo", Table2],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors",
                      view === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <PinButton question={question} answer={answer} datasetName={datasetName} pinId={pinId} onPinChange={setPinId} summary={summary} />
            <PdfButton item={{ question, datasetName, explanation: answer.explanation, sql: answer.sql, chart: answer.chart, result: answer.result, summary }} />
          </div>
          <ResultView result={answer.result} chart={answer.chart} mode={view === "table" ? "table" : "auto"} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
        <span>
          {formatInt(answer.result.rows.length)} satır
          {answer.limited && answer.result.rows.length >= 1000 ? " (ilk 1.000)" : ""}
        </span>
        <span>sorgu {formatInt(answer.result.ms)} ms</span>
        <span>toplam {formatInt(answer.totalMs)} ms</span>
        {answer.repairs > 0 && (
          <span className="flex items-center gap-1 text-outbound">
            <Wrench className="size-3" aria-hidden />
            {answer.repairs} otomatik onarım
          </span>
        )}
      </div>

      {!empty && <ExecutiveSummary question={question} answer={answer} onDone={onSummary} />}
      <SqlPeek sql={answer.sql} />
    </>
  );
}

function PinButton({
  question,
  answer,
  datasetName,
  pinId,
  onPinChange: setPinId,
  summary,
}: {
  question: string;
  answer: Answer;
  datasetName: string;
  pinId: string | null;
  onPinChange: (id: string | null) => void;
  summary?: string;
}) {
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setFailed(false);
    try {
      if (pinId) {
        await pinStore.remove(pinId);
        setPinId(null);
      } else {
        const pin = await pinStore.add({
          datasetName,
          question,
          explanation: answer.explanation,
          sql: answer.sql,
          chart: answer.chart,
          result: answer.result,
          summary,
        });
        setPinId(pin.id);
      }
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={pinId !== null}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
          pinId ? "border-foreground/30 bg-secondary text-foreground" : "bg-card text-muted-foreground hover:text-foreground",
        )}
      >
        {pinId ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
        {pinId ? "Panodan kaldır" : "Panoya sabitle"}
      </button>
      {failed && <span className="text-xs text-destructive">Pano bu tarayıcıda kaydedilemedi.</span>}
    </>
  );
}

/** Tek analizlik PDF rapor. Rapor kodu (jsPDF) yalnızca tıklanınca yüklenir. */
function PdfButton({ item }: { item: Omit<ReportItem, "createdAt"> }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function download() {
    setState("busy");
    try {
      const { downloadReport } = await import("@/lib/report");
      await downloadReport([{ ...item, createdAt: Date.now() }]);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        disabled={state === "busy"}
        className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
      >
        {state === "busy" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
        {state === "busy" ? "PDF hazırlanıyor…" : "PDF indir"}
      </button>
      {state === "error" && <span className="text-xs text-destructive">PDF oluşturulamadı.</span>}
    </>
  );
}

type SummaryState =
  | { status: "idle" }
  | { status: "confirm" }
  | { status: "loading" }
  | { status: "done"; text: string; rows: number }
  | { status: "error"; message: string };

/**
 * Veri sözleşmesinin tek istisnası: kullanıcı onaylarsa toplu sonuç tablosu modele gider.
 * Onaydan önce gidecek içerik açıkça gösterilir; sunucu ayrıca SQL'in toplulaştırılmış olduğunu doğrular.
 */
function ExecutiveSummary({ question, answer, onDone }: { question: string; answer: Answer; onDone: (text: string) => void }) {
  const [state, setState] = useState<SummaryState>({ status: "idle" });
  const payload = useMemo(() => summaryPayload(answer.result), [answer]);

  if (!payload.ok) {
    return <p className="text-xs text-muted-foreground">Yönetici özeti: {payload.reason}</p>;
  }

  async function send() {
    if (!payload.ok) return;
    setState({ status: "loading" });
    try {
      const text = await requestSummary({ question, sql: answer.sql, columns: payload.columns, rows: payload.rows });
      setState({ status: "done", text, rows: payload.rows.length });
      onDone(text);
    } catch (err) {
      setState({ status: "error", message: err instanceof ApiError ? err.message : "Özet oluşturulamadı." });
    }
  }

  if (state.status === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState({ status: "confirm" })}
        className="flex items-center gap-1.5 self-start rounded-md border bg-card px-3 py-1.5 text-sm transition-colors hover:border-outbound/60"
      >
        <Sparkles className="size-3.5 text-outbound" aria-hidden />
        Yönetici özeti çıkar
      </button>
    );
  }

  if (state.status === "confirm") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-outbound/40 bg-outbound-soft/60 p-3 text-sm">
        <p>
          Özet için bu sonucun <b>{payload.rows.length} satırı</b> ({payload.columns.join(", ")}) yapay zekâya gönderilecek.
          Dosyandaki ham kayıtlar gönderilmez; yalnızca yukarıdaki toplu tablo gider.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void send()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Gönder ve özetle
          </button>
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-muted"
          >
            Vazgeç
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-outbound" aria-hidden />
        Özet yazılıyor…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {state.message}
        <button
          type="button"
          onClick={() => setState({ status: "confirm" })}
          className="rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-1 border-l-2 border-outbound py-1 pl-3 animate-in fade-in">
      <figcaption className="text-xs text-muted-foreground">Yönetici özeti · modele {state.rows} satırlık toplu sonuç gönderildi</figcaption>
      <blockquote className="text-[15px] leading-relaxed">{state.text}</blockquote>
    </figure>
  );
}

function SqlPeek({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-md border bg-panel text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        {"SQL'i göster"}
      </summary>
      <div className="relative border-t">
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{sql}</pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(sql);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute top-2 right-2 flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </details>
  );
}

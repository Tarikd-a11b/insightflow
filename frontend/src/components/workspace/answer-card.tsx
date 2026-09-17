"use client";

import { AlertTriangle, BarChart3, Check, ChevronRight, Compass, Copy, CornerDownRight, Database, FileDown, FileSpreadsheet, Image as ImageIcon, Info, LineChart, Loader2, PieChart, Pin, PinOff, SearchX, ShieldCheck, Sparkles, Table2, Terminal, TrendingDown, TrendingUp, Wrench, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ApiError, requestSummary, summaryPayload, type ChartKind } from "@/lib/api";
import type { AskOutcome, AskStep } from "@/lib/ask";
import { getAvailableChartKinds, type ChartKindOption } from "@/lib/chart-spec";
import { downloadChartAsPng, downloadCsv } from "@/lib/export";
import { formatInt } from "@/lib/format";
import { pinStore } from "@/lib/pins";
import type { ReportItem } from "@/lib/report";
import { cn } from "@/lib/utils";
import { hasChart, ResultView } from "./result-view";

/** Soru adımları: sunucu uyanırken kuyrukta bekleme + onarım döngüsünün adımları. */
export type TurnStep = AskStep | { kind: "waiting" };

export interface Turn {
  id: number;
  question: string;
  step: TurnStep | null;
  /** Takip sorusuysa bağlam alınan tur. */
  parentId?: number;
  /** "explore": otomatik keşiften gelen, model kullanılmadan üretilmiş içgörü. */
  origin?: "explore";
  outcome: AskOutcome | null;
}

type Answer = Extract<AskOutcome, { kind: "answer" }>;

const STEP_TEXT: Record<TurnStep["kind"], string> = {
  waiting: "Yanıt motoru uyanıyor; hazır olunca soru gönderilecek…",
  writing: "DuckDB SQL sorgusu yazılıyor…",
  running: "In-memory DuckDB motorunda vektörize çalıştırılıyor…",
  repairing: "Şema uyumsuzluğu tespit edildi, AST onarılıyor…",
};

function stepText(step: TurnStep): string {
  return step.kind === "repairing" ? `Self-Healing: Hata otomatik onarılıyor (${step.attempt}/3)…` : STEP_TEXT[step.kind];
}

export function AnswerCard({
  turn,
  datasetName,
  onStop,
  onContinue,
  isContext = false,
  parentQuestion,
  tableNames = [],
}: {
  turn: Turn;
  datasetName: string;
  /** Ek tablo adları: yönetici özetinde sunucu SQL'i bu tablolarla doğrular. */
  tableNames?: string[];
  onStop: () => void;
  onContinue: (id: number) => void;
  isContext?: boolean;
  parentQuestion?: string;
}) {
  const { outcome } = turn;
  return (
    <article
      data-turn={turn.id}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5 backdrop-blur-xl transition-all shadow-xs last:border-border/70",
        isContext && "border-l-4 border-l-outbound bg-card/90 shadow-md",
      )}
    >
      {parentQuestion && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground font-mono">
          <CornerDownRight className="size-3.5 shrink-0 text-outbound" aria-hidden />
          <span className="truncate">&ldquo;{parentQuestion}&rdquo; sorgusunun devamı</span>
        </p>
      )}
      {turn.origin === "explore" && (
        <p className="inline-flex items-center gap-1.5 text-xs text-local font-mono">
          <Compass className="size-3.5" aria-hidden />
          Otomatik EDA Keşif Analizi &bull; Model Kullanılmadı
        </p>
      )}
      <h3 className="font-heading text-lg leading-snug font-semibold text-foreground">{turn.question}</h3>

      {!outcome && turn.step && (
        <div className="flex items-center gap-3">
          <p role="status" className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
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

      {outcome?.kind === "answer" && (
        <AnswerBody question={turn.question} answer={outcome} datasetName={datasetName} tableNames={tableNames} onContinue={() => onContinue(turn.id)} />
      )}
    </article>
  );
}

const CHART_ICONS: Record<ChartKind, typeof BarChart3> = {
  bar: BarChart3,
  line: LineChart,
  donut: PieChart,
  scatter: Zap,
  kpi: Sparkles,
  table: Table2,
};

function AnswerBody({
  question,
  answer,
  datasetName,
  onContinue,
  tableNames,
}: {
  question: string;
  answer: Answer;
  datasetName: string;
  onContinue: () => void;
  tableNames: string[];
}) {
  const chartOptions = useMemo(() => getAvailableChartKinds(answer.result), [answer.result]);
  const initialChart = useMemo<ChartKind>(() => {
    const directMatch = chartOptions.find((o) => o.kind === answer.chart && o.available);
    if (directMatch) return answer.chart;
    const firstAvailable = chartOptions.find((o) => o.available);
    return firstAvailable ? firstAvailable.kind : "table";
  }, [chartOptions, answer.chart]);

  const [selectedChart, setSelectedChart] = useState<ChartKind>(initialChart);
  const [pinId, setPinId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | undefined>(undefined);
  const resultRef = useRef<HTMLDivElement>(null);
  const empty = answer.result.rows.length === 0;

  function onSummary(text: string) {
    setSummary(text);
    if (pinId) void pinStore.update(pinId, { summary: text }).catch(() => {});
  }

  return (
    <>
      <p className="text-sm leading-relaxed text-foreground/90">{answer.explanation}</p>

      {empty ? (
        <p className="text-sm text-muted-foreground">Sorgu çalıştı ama koşula uyan kayıt yok. Filtreyi genişletmeyi deneyin.</p>
      ) : (
        <>
          {/* Akıllı Grafik & Görünüm Değiştirici (Dynamic Chart Switcher with Heuristics) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div role="tablist" aria-label="Görselleştirme Seçimi" className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-panel/80 p-1 text-xs shadow-inner backdrop-blur-sm">
              {chartOptions.map((opt) => {
                const Icon = CHART_ICONS[opt.kind] ?? BarChart3;
                const isSelected = selectedChart === opt.kind;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    disabled={!opt.available}
                    onClick={() => opt.available && setSelectedChart(opt.kind)}
                    title={opt.available ? `${opt.label} Grafiğine Geç` : `${opt.label}: ${opt.reason}`}
                    className={cn(
                      "group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all select-none",
                      isSelected
                        ? "bg-card text-foreground font-semibold shadow-xs ring-1 ring-border/80"
                        : opt.available
                        ? "text-muted-foreground hover:bg-card/50 hover:text-foreground cursor-pointer"
                        : "text-muted-foreground/35 cursor-not-allowed opacity-50",
                    )}
                  >
                    <Icon className={cn("size-3.5", isSelected ? "text-outbound" : opt.available ? "text-muted-foreground" : "text-muted-foreground/30")} aria-hidden />
                    <span>{opt.label}</span>
                    {!opt.available && (
                      <span className="ml-0.5 inline-block size-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <PinButton question={question} answer={{ ...answer, chart: selectedChart }} datasetName={datasetName} pinId={pinId} onPinChange={setPinId} summary={summary} />
              <button
                type="button"
                onClick={onContinue}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-all hover:border-outbound/60 hover:text-foreground hover:shadow-xs cursor-pointer"
              >
                <CornerDownRight className="size-3.5 text-outbound" aria-hidden />
                Takip Sorusu
              </button>
              <PdfButton item={{ question, datasetName, explanation: answer.explanation, sql: answer.sql, chart: selectedChart, result: answer.result, summary }} />
              <CsvButton result={answer.result} question={question} />
              {selectedChart !== "table" && selectedChart !== "kpi" && (
                <PngButton containerRef={resultRef} question={question} />
              )}
            </div>
          </div>

          <div ref={resultRef}>
            <ResultView result={answer.result} chart={selectedChart} mode={selectedChart === "table" ? "table" : "auto"} />
          </div>
        </>
      )}

      {/* Veri Mühendisliği Telemetri Çubuğu (Data Engine Telemetry Bar) */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-panel/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur-sm">
        <span className="flex items-center gap-1 text-local font-semibold">
          <Database className="size-3" />
          DuckDB: {formatInt(answer.result.ms)} ms
        </span>
        <span className="text-border">&bull;</span>
        <span className="flex items-center gap-1 text-foreground">
          <Table2 className="size-3 text-muted-foreground" />
          {formatInt(answer.result.rows.length)} Satır {answer.limited && answer.result.rows.length >= 1000 ? " (Limit 1.000)" : ""}
        </span>
        <span className="text-border">&bull;</span>
        <span>E2E: {formatInt(answer.totalMs)} ms</span>
        <span className="text-border">&bull;</span>
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3" />
          AST Validated (Safe SELECT)
        </span>
        {answer.repairs > 0 && (
          <>
            <span className="text-border">&bull;</span>
            <span className="flex items-center gap-1 text-outbound font-medium">
              <Wrench className="size-3" aria-hidden />
              {answer.repairs} Self-Healing Onarım
            </span>
          </>
        )}
      </div>

      {!empty && <ExecutiveSummary question={question} answer={answer} tableNames={tableNames} onDone={onSummary} />}
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
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all cursor-pointer",
          pinId ? "border-foreground/30 bg-secondary text-foreground font-medium" : "border-border/70 bg-card text-muted-foreground hover:text-foreground hover:shadow-xs",
        )}
      >
        {pinId ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
        {pinId ? "Panodan Kaldır" : "Panoya Sabitle"}
      </button>
      {failed && <span className="text-xs text-destructive">Pano bu tarayıcıda kaydedilemedi.</span>}
    </>
  );
}

/** Tek analizlik PDF rapor. */
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
        className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:shadow-xs disabled:opacity-60 cursor-pointer"
      >
        {state === "busy" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
        {state === "busy" ? "PDF Hazırlanıyor…" : "PDF İndir"}
      </button>
      {state === "error" && <span className="text-xs text-destructive">PDF oluşturulamadı.</span>}
    </>
  );
}

/** Sonuç tablosunu Türkçe UTF-8 BOM ile CSV olarak indirir. */
function CsvButton({ result, question }: { result: Answer["result"]; question: string }) {
  function download() {
    const slug = question.slice(0, 30).toLowerCase().replace(/[^a-z0-9ğüşıöç]+/gi, "-").replace(/^-|-$/g, "");
    downloadCsv(result, `insightflow-${slug || "veri"}.csv`);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:shadow-xs cursor-pointer"
      title="Sonuç verisini Excel uyumlu CSV olarak indir"
    >
      <FileSpreadsheet className="size-3.5" aria-hidden />
      CSV İndir
    </button>
  );
}

/** ECharts SVG grafiğini yüksek çözünürlüklü PNG olarak indirir. */
function PngButton({ containerRef, question }: { containerRef: React.RefObject<HTMLDivElement | null>; question: string }) {
  const [loading, setLoading] = useState(false);

  async function download() {
    if (!containerRef.current) return;
    setLoading(true);
    try {
      const slug = question.slice(0, 30).toLowerCase().replace(/[^a-z0-9ğüşıöç]+/gi, "-").replace(/^-|-$/g, "");
      await downloadChartAsPng(containerRef.current, `insightflow-${slug || "grafik"}.png`);
    } catch {
      // Hata durumunda sessiz kal
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-all hover:text-foreground hover:shadow-xs disabled:opacity-60 cursor-pointer"
      title="Grafiği yüksek kaliteli PNG resmi olarak indir"
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />}
      PNG İndir
    </button>
  );
}

type SummaryState =
  | { status: "idle" }
  | { status: "confirm" }
  | { status: "loading" }
  | { status: "done"; text: string; rows: number }
  | { status: "error"; message: string };

function ExecutiveSummary({
  question,
  answer,
  tableNames,
  onDone,
}: {
  question: string;
  answer: Answer;
  tableNames: string[];
  onDone: (text: string) => void;
}) {
  const [state, setState] = useState<SummaryState>({ status: "idle" });
  const payload = useMemo(() => summaryPayload(answer.result), [answer]);

  if (!payload.ok) {
    return <p className="text-xs text-muted-foreground">Yönetici özeti: {payload.reason}</p>;
  }

  async function send() {
    if (!payload.ok) return;
    setState({ status: "loading" });
    try {
      const text = await requestSummary({ question, sql: answer.sql, columns: payload.columns, rows: payload.rows, tables: tableNames });
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
        className="flex items-center gap-1.5 self-start rounded-xl border border-outbound/30 bg-outbound-soft/50 px-3 py-1.5 text-xs font-medium text-outbound transition-all hover:border-outbound hover:bg-outbound-soft hover:shadow-xs cursor-pointer"
      >
        <Sparkles className="size-3.5 text-outbound" aria-hidden />
        Yönetici Özeti Çıkar
      </button>
    );
  }

  if (state.status === "confirm") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-outbound/40 bg-outbound-soft/60 p-3 text-xs">
        <p>
          Özet için bu sonucun <b>{payload.rows.length} satırı</b> ({payload.columns.join(", ")}) yapay zekâya gönderilecek.
          Dosyandaki ham kayıtlar gönderilmez; yalnızca yukarıdaki toplu tablo gider.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void send()}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
          >
            Gönder ve Özetle
          </button>
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="rounded-lg border bg-card px-3 py-1.5 text-xs hover:bg-muted cursor-pointer"
          >
            Vazgeç
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-outbound" aria-hidden />
        Yönetici özeti yazılıyor…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {state.message}
        <button
          type="button"
          onClick={() => setState({ status: "confirm" })}
          className="rounded-md border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-2 rounded-2xl border border-outbound/30 bg-outbound-soft/30 p-4 animate-in fade-in shadow-xs backdrop-blur-sm">
      <figcaption className="text-[11px] font-mono text-outbound font-semibold flex items-center justify-between border-b border-outbound/20 pb-2">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-outbound" />
          YÖNETİCİ İÇGÖRÜSÜ &bull; Modele {state.rows} satırlık toplu sonuç iletildi
        </span>
        <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">AI Executive Brief</span>
      </figcaption>
      <blockquote className="pt-1">
        <FormattedExecutiveText text={state.text} />
      </blockquote>
    </figure>
  );
}

function FormattedExecutiveText({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
      {lines.map((line, idx) => {
        const isBullet = /^[•\-*]\s+/.test(line.trim());
        const cleanLine = line.trim().replace(/^[•\-*]\s+/, "");
        const tokens = cleanLine.split(/(\b(?:artış|büyüme|yükseliş|rekor|zirve|düşüş|azalış|daralma|gerileme|kayıp|risk)\b|[-+]?%?\d+(?:[.,]\d+)?%?)/gi);

        return (
          <p key={idx} className={cn("flex items-start gap-2", isBullet && "pl-1.5")}>
            {isBullet && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-outbound" aria-hidden />}
            <span className="flex-1">
              {tokens.map((token, tIdx) => {
                const lower = token.toLowerCase();
                const isGrowth = /^(artış|büyüme|yükseliş|rekor|zirve)$/.test(lower) || /^\+|^%\+/.test(token);
                const isDecline = /^(düşüş|azalış|daralma|gerileme|kayıp|risk)$/.test(lower) || /^-\d|^%-\d/.test(token);

                if (isGrowth) {
                  return (
                    <span
                      key={tIdx}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 mx-0.5 align-baseline"
                    >
                      <TrendingUp className="size-3 shrink-0" />
                      {token}
                    </span>
                  );
                }
                if (isDecline) {
                  return (
                    <span
                      key={tIdx}
                      className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/25 mx-0.5 align-baseline"
                    >
                      <TrendingDown className="size-3 shrink-0" />
                      {token}
                    </span>
                  );
                }
                if (/\d+%/.test(token) || /%\d+/.test(token)) {
                  return (
                    <span key={tIdx} className="font-mono font-semibold text-foreground underline decoration-outbound/50 decoration-2 underline-offset-2">
                      {token}
                    </span>
                  );
                }
                return token;
              })}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function SqlPeek({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-xl border border-border/70 bg-panel/70 text-xs overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2 font-mono text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          <Terminal className="size-3 text-outbound" />
          <span>Doğrulanmış DuckDB SQL Sorgusu</span>
        </span>
        <span className="text-[10px] text-muted-foreground/70 uppercase">AST Validated</span>
      </summary>
      <div className="relative border-t border-border/60 bg-card/40 p-3">
        <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90">{sql}</pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(sql);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-md border border-border/80 bg-card/90 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground backdrop-blur-md cursor-pointer"
        >
          {copied ? <Check className="size-3 text-local" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </details>
  );
}

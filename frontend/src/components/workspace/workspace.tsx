"use client";

import { ArrowLeft, ArrowUp, Compass, CornerDownRight, Database, LayoutTemplate, Loader2, RefreshCw, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, checkHealth, toColumnPayload, type HistoryItem, type SchemaPayload } from "@/lib/api";
import { ask } from "@/lib/ask";
import { generateAutoDashboard } from "@/lib/dashboard-generator";
import { suggestJoinQuestions, suggestQuestions } from "@/lib/data/questions";
import { PRIMARY_TABLE, relationshipPayload } from "@/lib/data/tables";
import { countSharedValues, MAX_SHARED_VALUES, type SharedValues } from "@/lib/data/sample-values";
import { runExplore } from "@/lib/explore";
import { buildHistory, latestAnsweredId, type ContextTurn } from "@/lib/followup";
import { formatBytes, formatInt } from "@/lib/format";
import { watchHealth, type HealthState } from "@/lib/health-watch";
import { outboundLog, totals } from "@/lib/outbound-log";
import { cn } from "@/lib/utils";
import { AnswerCard, type Turn } from "./answer-card";
import { DatasetPicker } from "./dataset-picker";
import { useOutboundLog, usePins } from "./hooks";
import { OutboundPanel } from "./outbound-panel";
import { Pinboard } from "./pinboard";
import { PreviewTable } from "./preview-table";
import { PrivacyLedger } from "./privacy-ledger";
import { SampleValuesDialog } from "./sample-values-dialog";
import { TablesPanel } from "./tables-panel";
import { SchemaPanel } from "./schema-panel";
import { ThemeToggle } from "./theme-toggle";
import { useDataset } from "./use-dataset";

type View = "answers" | "board" | "preview";
/** Takip bağlamı: son yanıt (varsayılan), belirli bir kart ya da bağlamsız. */
type ContextChoice = { mode: "auto" } | { mode: "none" } | { mode: "turn"; id: number };

const HEALTH_MESSAGE: Record<"unreachable" | "unconfigured", string> = {
  unreachable: "Yanıt motoruna ulaşılamıyor. Verini inceleyebilirsin ama soru soramazsın.",
  unconfigured: "Yanıt motoru çalışıyor ama yapay zekâ anahtarı tanımlı değil (GEMINI_API_KEY).",
};

export function Workspace() {
  const { state, load, addFiles, removeTable, reset, engine } = useDataset();
  const ready = state.status === "ready" ? state : null;
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [view, setView] = useState<View>("answers");
  const [boardOnly, setBoardOnly] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sharedValues, setSharedValues] = useState<SharedValues>({});
  const [valuesDialogOpen, setValuesDialogOpen] = useState(false);
  const [health, setHealth] = useState<HealthState>("checking");
  const [contextChoice, setContextChoice] = useState<ContextChoice>({ mode: "auto" });
  const [exploring, setExploring] = useState(false);
  const [generatingDashboard, setGeneratingDashboard] = useState(false);
  const [selectedTable, setSelectedTable] = useState(PRIMARY_TABLE);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const stopHealthRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<{ id: number; question: string; schema: SchemaPayload; history: HistoryItem[] } | null>(null);
  const healthRef = useRef<HealthState>("checking");
  const onHealthRef = useRef<(state: HealthState) => void>(() => {});

  const sharedCount = countSharedValues(sharedValues);
  const readValues = useCallback(
    (table: string, column: string) => engine.current?.distinctValues(table, column, MAX_SHARED_VALUES) ?? Promise.resolve([]),
    [engine],
  );

  const log = useOutboundLog();
  const sent = useMemo(() => totals(log), [log]);
  const { pins, unavailable: pinsUnavailable } = usePins();
  const extraTables = useMemo(() => (ready ? ready.tables.filter((t) => t.table !== PRIMARY_TABLE) : []), [ready]);
  const suggestions = useMemo(() => {
    if (!ready) return [];
    const related = new Set(ready.relationships.flatMap((r) => [r.left.table, r.right.table]));
    const join = suggestJoinQuestions(ready.profile.columns, extraTables, related);
    return [...join, ...suggestQuestions(ready.profile.columns, 4 - join.length)];
  }, [ready, extraTables]);
  const totalRows = ready ? ready.tables.reduce((n, t) => n + t.rowCount, 0) : null;
  const totalColumns = ready ? ready.tables.reduce((n, t) => n + t.columns.length, 0) : 0;
  const shownTable = ready?.tables.find((t) => t.table === selectedTable) ?? ready?.profile;
  const datasetLabel = ready ? ready.profile.name + (extraTables.length ? ` + ${extraTables.map((t) => t.table).join(", ")}` : "") : "";
  const busy = turns.some((t) => t.outcome === null);
  const contextTurns: ContextTurn[] = useMemo(
    () => turns.map((t) => ({ id: t.id, question: t.question, parentId: t.parentId, sql: t.outcome?.kind === "answer" ? t.outcome.sql : undefined })),
    [turns],
  );
  const autoContextId = useMemo(
    () => latestAnsweredId(contextTurns.filter((t) => turns.find((x) => x.id === t.id)?.origin !== "explore")),
    [contextTurns, turns],
  );
  const contextId = contextChoice.mode === "none" ? null : contextChoice.mode === "turn" ? contextChoice.id : autoContextId;
  const contextQuestion = contextId === null ? null : (turns.find((t) => t.id === contextId)?.question ?? null);
  const inputLocked = health === "unreachable" || health === "unconfigured";

  const refreshHealth = useCallback(() => {
    stopHealthRef.current?.();
    stopHealthRef.current = watchHealth(checkHealth, (state) => onHealthRef.current(state));
  }, []);

  const updateTurn = (id: number, patch: Partial<Turn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  useEffect(() => {
    onHealthRef.current = (state) => {
      healthRef.current = state;
      setHealth(state);
      const pending = pendingRef.current;
      if (!pending) return;
      if (state === "ok") {
        pendingRef.current = null;
        void runTurn(pending.id, pending.question, pending.schema, pending.history);
      } else if (state === "unreachable" || state === "unconfigured") {
        pendingRef.current = null;
        updateTurn(pending.id, {
          step: null,
          outcome: { kind: "failed", message: "Yanıt motoruna ulaşılamadı; soru gönderilmedi. Sunucu hazır olunca yeniden sorabilirsin." },
        });
      }
    };
  });

  useEffect(() => {
    refreshHealth();
    return () => stopHealthRef.current?.();
  }, [refreshHealth]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  function closeDataset() {
    abortRef.current?.abort();
    pendingRef.current = null;
    setTurns([]);
    setView("answers");
    setQuestion("");
    setBoardOnly(false);
    outboundLog.clear();
    setSharedValues({});
    setContextChoice({ mode: "auto" });
    setSelectedTable(PRIMARY_TABLE);
    void reset();
  }

  function stop() {
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      updateTurn(pending.id, { step: null, outcome: { kind: "failed", message: "Soru durduruldu." } });
      return;
    }
    abortRef.current?.abort();
  }

  async function runTurn(id: number, q: string, schema: SchemaPayload, history: HistoryItem[]) {
    const current = engine.current;
    if (!current) {
      updateTurn(id, { step: null, outcome: { kind: "failed", message: "Veri seti kapatıldığı için soru gönderilmedi." } });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    updateTurn(id, { step: { kind: "writing" } });
    try {
      const outcome = await ask(current, q, schema, (step) => updateTurn(id, { step }), controller.signal, history);
      updateTurn(id, { outcome, step: null });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const message = aborted ? "Soru durduruldu." : err instanceof ApiError ? err.message : "Beklenmeyen bir hata oluştu.";
      updateTurn(id, { outcome: { kind: "failed", message }, step: null });
      if (err instanceof ApiError && err.status === 0) refreshHealth();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function submit(text: string) {
    const q = text.trim();
    if (q.length < 2 || busy || !ready || !engine.current || inputLocked) return;

    const id = nextId.current++;
    const schema: SchemaPayload = {
      columns: toColumnPayload(ready.profile.columns, sharedValues),
      tables: extraTables.map((t) => ({ name: t.table, columns: toColumnPayload(t.columns, sharedValues, `${t.table}.`) })),
      relationships: relationshipPayload(ready.relationships),
    };
    const waking = healthRef.current === "waking";
    const history = buildHistory(contextTurns, contextId);
    const parentId = history.length ? (contextId ?? undefined) : undefined;
    setTurns((all) => [...all, { id, question: q, parentId, step: { kind: waking ? "waiting" : "writing" }, outcome: null }]);
    setQuestion("");
    setView("answers");
    setContextChoice({ mode: "auto" });

    if (waking) {
      pendingRef.current = { id, question: q, schema, history };
      return;
    }
    void runTurn(id, q, schema, history);
  }

  async function explore() {
    const current = engine.current;
    if (!ready || !current || exploring) return;
    setExploring(true);
    setView("answers");
    try {
      const insights = await runExplore(current, ready.profile);
      if (engine.current !== current) return;
      const newTurns: Turn[] = insights.map((insight) => ({
        id: nextId.current++,
        question: insight.title,
        origin: "explore",
        step: null,
        outcome: {
          kind: "answer",
          sql: insight.sql,
          explanation: insight.headline,
          chart: insight.chart,
          limited: false,
          result: insight.result,
          repairs: 0,
          totalMs: insight.ms,
        },
      }));
      setTurns((all) => [...all, ...newTurns]);
    } finally {
      setExploring(false);
    }
  }

  /** 🌟 AI Otomatik Dashboard Üretici: Tek tıkla 4 KPI & Trend grafiğini panoya dizer */
  async function triggerAutoDashboard() {
    const current = engine.current;
    if (!ready || !current || generatingDashboard) return;
    setGeneratingDashboard(true);
    try {
      await generateAutoDashboard(current, ready.profile);
      setView("board");
    } finally {
      setGeneratingDashboard(false);
    }
  }

  function continueFrom(id: number) {
    setContextChoice({ mode: "turn", id });
    setView("answers");
    inputRef.current?.focus();
  }

  const header = (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-border/75 bg-panel/85 px-4 sm:px-6 py-2.5 backdrop-blur-2xl transition-all">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={closeDataset}
          className="group flex items-center gap-2 font-heading text-lg font-bold tracking-tight text-foreground transition-opacity hover:opacity-90"
          aria-label="InsightFlow, başa dön"
        >
          <div className="size-2 rounded-full bg-local animate-pulse" />
          <span>Insight<span className="text-local">Flow</span></span>
        </button>

        {ready && (
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/75 bg-card/80 px-3 py-1 text-xs shadow-sm backdrop-blur-md">
            <Database className="size-3.5 text-local" />
            <span className="truncate font-semibold text-foreground max-w-[140px] sm:max-w-[200px]">{ready.profile.name}</span>
            {extraTables.length > 0 && (
              <span className="shrink-0 rounded-md bg-local-soft px-1.5 py-0.2 font-mono text-[10px] font-semibold text-local border border-local/20">
                +{extraTables.length} tablo
              </span>
            )}
            <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
              &bull; {formatInt(totalColumns)} sütun &bull; {formatBytes(ready.sizeBytes)}
            </span>
            <button
              type="button"
              onClick={closeDataset}
              className="grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ml-1"
              title="Veri setini kapat ve ana ekrana dön"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Üstte Parlayan AI Dashboard Butonu */}
        {ready && (
          <button
            type="button"
            onClick={() => void triggerAutoDashboard()}
            disabled={generatingDashboard}
            className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-outbound/35 bg-outbound-soft/70 px-3.5 py-1.5 text-xs font-semibold text-outbound shadow-sm backdrop-blur-md transition-all hover:border-outbound hover:bg-outbound-soft hover:shadow-md active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            {generatingDashboard ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            <span>{generatingDashboard ? "Dashboard Hazırlanıyor…" : "✨ AI Dashboard Hazırla"}</span>
          </button>
        )}

        <PrivacyLedger rowCount={totalRows} sent={sent} onOpen={() => setPanelOpen(true)} />
        <ThemeToggle />
      </div>
    </header>
  );

  const panel = (
    <OutboundPanel open={panelOpen} onClose={() => setPanelOpen(false)} entries={log} rowCount={totalRows} />
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col bg-background selection:bg-outbound/20">
        {header}
        <main className="flex-1 overflow-y-auto">
          {boardOnly ? (
            <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setBoardOnly(false)}
                  className="flex items-center gap-1.5 rounded-xl border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors shadow-sm cursor-pointer"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Geri Dön
                </button>
                <h1 className="font-heading text-2xl font-bold">Sabitlenen Analiz Panosu</h1>
              </div>
              <Pinboard pins={pins} unavailable={pinsUnavailable} />
            </div>
          ) : (
            <DatasetPicker
              onFiles={(entries) => void load(entries)}
              loadingName={state.status === "loading" ? state.name : null}
              error={state.status === "error" ? state.message : null}
              pinCount={pins?.length ?? 0}
              onOpenBoard={() => setBoardOnly(true)}
            />
          )}
        </main>
        {panel}
      </div>
    );
  }

  const tabs: [View, string, string][] = [
    ["answers", "Sohbet & Analiz", `${turns.length}`],
    ["preview", "Veri Tablosu", `${formatInt(shownTable?.rowCount ?? ready.profile.rowCount)}`],
    ["board", "Panom (Dashboard)", `${pins?.length ?? 0}`],
  ];

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden selection:bg-outbound/20">
      {header}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Sol Sidebar (Denetim & Hızlı Eylemler Paneli) */}
        <aside className="flex flex-col gap-5 border-b border-border/70 bg-panel/50 p-4 lg:w-[22rem] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0 backdrop-blur-md">
          
          {/* ✨ AI Dashboard Hazırla Butonu (Sidebar) */}
          <button
            type="button"
            onClick={() => void triggerAutoDashboard()}
            disabled={generatingDashboard}
            className="group relative flex items-center gap-3 rounded-2xl border border-outbound/40 bg-outbound-soft/70 p-3.5 text-left transition-all hover:border-outbound hover:bg-outbound-soft hover:shadow-lg disabled:opacity-60 cursor-pointer shadow-sm"
          >
            <div className="grid size-9 place-items-center rounded-xl bg-outbound text-primary-foreground shadow-sm">
              {generatingDashboard ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LayoutTemplate className="size-5" aria-hidden />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-heading text-sm font-bold text-foreground group-hover:text-outbound transition-colors">
                {generatingDashboard ? "Oluşturuluyor…" : "✨ AI Dashboard Hazırla"}
              </span>
              <span className="text-[11px] text-muted-foreground">Tek tıkla 4 parçalı kurumsal özet</span>
            </div>
          </button>

          {/* Keşfet Butonu */}
          <button
            type="button"
            onClick={() => void explore()}
            disabled={exploring}
            className="group relative flex items-center gap-3 rounded-2xl border border-local/40 bg-local-soft/60 p-3 text-left transition-all hover:border-local hover:bg-local-soft/90 hover:shadow-md disabled:opacity-60 cursor-pointer"
          >
            <div className="grid size-8 place-items-center rounded-lg bg-local/15 text-local">
              {exploring ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Compass className="size-4" aria-hidden />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-heading text-xs font-semibold text-foreground group-hover:text-local transition-colors">
                {exploring ? "Analiz Ediliyor…" : "Veriyi Otomatik Keşfet"}
              </span>
              <span className="text-[10px] text-muted-foreground">Kural tabanlı hazır içgörüler</span>
            </div>
          </button>

          {/* Hızlı Örnek Sorular */}
          <section aria-labelledby="questions-heading" className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 id="questions-heading" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5 font-mono">
                <Sparkles className="size-3 text-outbound" />
                Önerilen Sorular
              </h2>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy || inputLocked}
                  onClick={() => void submit(q)}
                  className="rounded-xl border border-border/70 bg-card/65 px-3 py-2 text-left text-xs font-medium text-foreground/90 transition-all hover:border-foreground/30 hover:bg-card hover:shadow-xs hover:translate-x-0.5 disabled:opacity-50 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </section>

          {/* Tablo & Şema İnceleme */}
          <div className="flex flex-col gap-4 border-t border-border/60 pt-4">
            <TablesPanel
              tables={ready.tables}
              relationships={ready.relationships}
              selected={shownTable?.table ?? PRIMARY_TABLE}
              onSelect={setSelectedTable}
              onAddFiles={(files) => void addFiles(files)}
              onRemove={(table) => {
                if (selectedTable === table) setSelectedTable(PRIMARY_TABLE);
                setSharedValues((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith(`${table}.`))));
                void removeTable(table);
              }}
              reloading={ready.reloading}
              error={ready.addError}
            />
            <SchemaPanel profile={shownTable ?? ready.profile} />
          </div>
        </aside>

        {/* Ana Analitik & Görselleştirme Alanı */}
        <main className="relative flex min-h-0 flex-1 flex-col p-4 sm:p-6 overflow-hidden">
          
          {/* Üst Sekmeler (Segmented Controls) */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/50 shrink-0">
            <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-xl border border-border/70 bg-panel/80 p-1 text-xs shadow-inner backdrop-blur-md">
              {tabs.map(([key, label, badge]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => setView(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap transition-all duration-200 cursor-pointer",
                    view === key
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>{label}</span>
                  {badge && badge !== "0" && (
                    <span className={cn(
                      "rounded-full px-1.5 py-0.2 font-mono text-[10px]",
                      view === key ? "bg-primary/10 text-primary font-bold" : "bg-muted text-muted-foreground"
                    )}>
                      {badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {view === "preview" && (
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {shownTable?.table} &bull; ilk {formatInt((ready.previews[shownTable?.table ?? PRIMARY_TABLE] ?? ready.preview).rows.length)} /{" "}
                {formatInt(shownTable?.rowCount ?? ready.profile.rowCount)} satır
              </span>
            )}
          </div>

          {/* İçerik Alanı */}
          <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-1">
            
            {view === "preview" && (
              <div className="h-full rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm overflow-hidden p-1 shadow-sm">
                <PreviewTable
                  key={shownTable?.table}
                  result={ready.previews[shownTable?.table ?? PRIMARY_TABLE] ?? ready.preview}
                  columns={(shownTable ?? ready.profile).columns}
                  className="h-full"
                />
              </div>
            )}

            {view === "board" && (
              <div className="h-full">
                <Pinboard pins={pins} unavailable={pinsUnavailable} />
              </div>
            )}

            {view === "answers" && (
              <div className="flex flex-col gap-6 pb-28">
                {turns.length === 0 ? (
                  <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center animate-in fade-in duration-500">
                    <div className="grid size-12 place-items-center rounded-2xl bg-local-soft text-local border border-local/30 shadow-sm">
                      <Sparkles className="size-6" aria-hidden />
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="font-heading text-lg font-bold text-foreground">Analize Başlamaya Hazır Mısın?</p>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                        Aşağıdaki komut çubuğuna Türkçe bir soru yazabilir veya tek tıkla otomatik dashboard oluşturabilirsiniz.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void triggerAutoDashboard()}
                        disabled={generatingDashboard}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-60 cursor-pointer"
                      >
                        {generatingDashboard ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <LayoutTemplate className="size-3.5" aria-hidden />}
                        <span>✨ AI Dashboard Oluştur</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
                    {turns.map((t) => (
                      <AnswerCard
                        key={t.id}
                        turn={t}
                        datasetName={datasetLabel}
                        tableNames={extraTables.map((t) => t.table)}
                        onStop={stop}
                        onContinue={continueFrom}
                        isContext={t.id === contextId}
                        parentQuestion={t.parentId === undefined ? undefined : turns.find((p) => p.id === t.parentId)?.question}
                      />
                    ))}
                    <div ref={threadEndRef} />
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Sunucu Durum Bildirimleri */}
          {health === "waking" && (
            <div role="status" className="mb-2 flex items-center gap-3 rounded-xl border border-outbound/30 bg-outbound-soft/60 px-4 py-2.5 text-xs text-muted-foreground backdrop-blur-md animate-in fade-in">
              <Loader2 className="size-4 shrink-0 animate-spin text-outbound" aria-hidden />
              <span>
                <strong className="text-foreground font-semibold">Yanıt motoru hazırlanıyor…</strong> Sunucu uyanınca sorunuz otomatik işlenecek.
              </span>
            </div>
          )}

          {(health === "unreachable" || health === "unconfigured") && (
            <div role="alert" className="mb-2 flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive backdrop-blur-md animate-in fade-in">
              <span>{HEALTH_MESSAGE[health]}</span>
              <button
                type="button"
                onClick={refreshHealth}
                className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-destructive/30 bg-card px-2 py-1 text-xs text-destructive hover:bg-destructive/20 transition-colors"
              >
                <RefreshCw className="size-3" aria-hidden />
                Tekrar Dene
              </button>
            </div>
          )}

          {/* Floating Command Bar */}
          <div className="absolute bottom-4 left-4 right-4 sm:left-6 sm:right-6 max-w-4xl mx-auto z-20">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(question);
              }}
              className={cn(
                "relative flex flex-col gap-2 rounded-2xl border border-border/80 bg-card/90 p-3 shadow-2xl backdrop-blur-2xl transition-all duration-300 focus-within:border-foreground/40 focus-within:shadow-indigo-500/10",
                inputLocked && "opacity-60"
              )}
            >
              {contextQuestion && !inputLocked && (
                <div className="flex min-w-0 items-center gap-1.5 px-2 text-[11px] text-muted-foreground animate-in fade-in">
                  <CornerDownRight className="size-3 text-outbound shrink-0" aria-hidden />
                  <span className="shrink-0">Önceki soruyla bağlantılı:</span>
                  <span className="truncate font-semibold text-foreground" title={contextQuestion}>
                    &ldquo;{contextQuestion}&rdquo;
                  </span>
                  <button
                    type="button"
                    onClick={() => setContextChoice({ mode: "none" })}
                    className="grid size-4 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground ml-1"
                    aria-label="Önceki soruyla bağlantıyı kaldır"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 px-1">
                <label htmlFor="question" className="sr-only">
                  Verinize soru sorun
                </label>
                <textarea
                  id="question"
                  ref={inputRef}
                  rows={1}
                  maxLength={500}
                  value={question}
                  disabled={inputLocked}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit(question);
                    }
                  }}
                  placeholder="Veriniz hakkında bir metrik veya soru yazın… (Örn: En karlı 5 kategori hangisi?)"
                  className="w-full resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                />

                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-destructive text-destructive-foreground shadow-sm transition-all hover:opacity-90 active:scale-95 cursor-pointer"
                    aria-label="Soruyu durdur"
                  >
                    <Square className="size-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={question.trim().length < 2 || inputLocked}
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 cursor-pointer"
                    aria-label="Soruyu gönder"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                )}
              </div>

              {/* Alt Gizlilik & Metrik Bilgisi */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-2 pt-2 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-local shrink-0" />
                  <span>
                    Yapay zekâya yalnızca <span className="font-semibold text-outbound">{totalColumns} sütun şeması</span> gider. Ham veri cihazınızda kalır.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setValuesDialogOpen(true)}
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    {sharedCount > 0 ? `${sharedCount} Örnek Değer` : "Örnek Değer Paylaş"}
                  </button>
                  <span>&bull;</span>
                  <button
                    type="button"
                    onClick={() => setPanelOpen(true)}
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    Gidenleri Gör
                  </button>
                </div>
              </div>
            </form>
          </div>

        </main>
      </div>

      {panel}
      <SampleValuesDialog
        open={valuesDialogOpen}
        onClose={() => setValuesDialogOpen(false)}
        tables={ready.tables}
        shared={sharedValues}
        onChange={setSharedValues}
        readValues={readValues}
      />
    </div>
  );
}

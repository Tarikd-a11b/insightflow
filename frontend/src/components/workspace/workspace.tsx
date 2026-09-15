"use client";

import { ArrowLeft, ArrowUp, Compass, CornerDownRight, Loader2, RefreshCw, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, checkHealth, toColumnPayload, type HistoryItem, type SchemaPayload } from "@/lib/api";
import { ask } from "@/lib/ask";
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
  const [view, setView] = useState<View>("preview");
  const [boardOnly, setBoardOnly] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // Onayla paylaşılan örnek değerler (sütun → değerler). Boş = yalnızca şema gider.
  const [sharedValues, setSharedValues] = useState<SharedValues>({});
  const [valuesDialogOpen, setValuesDialogOpen] = useState(false);
  const [health, setHealth] = useState<HealthState>("checking");
  const [contextChoice, setContextChoice] = useState<ContextChoice>({ mode: "auto" });
  const [exploring, setExploring] = useState(false);
  // Şema panelinde ve önizlemede gösterilen tablo.
  const [selectedTable, setSelectedTable] = useState(PRIMARY_TABLE);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const stopHealthRef = useRef<(() => void) | null>(null);
  // Sunucu uyanırken sorulan soru burada bekler; sağlık durumu "ok" olunca gönderilir.
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
    return [...join, ...suggestQuestions(ready.profile.columns, 6 - join.length)];
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
  // Otomatik bağlam yalnızca kullanıcının sorduğu sorulardan gelir; keşif içgörüsüne "Buna devam et" ile açıkça bağlanılır.
  const autoContextId = useMemo(
    () => latestAnsweredId(contextTurns.filter((t) => turns.find((x) => x.id === t.id)?.origin !== "explore")),
    [contextTurns, turns],
  );
  const contextId = contextChoice.mode === "none" ? null : contextChoice.mode === "turn" ? contextChoice.id : autoContextId;
  const contextQuestion = contextId === null ? null : (turns.find((t) => t.id === contextId)?.question ?? null);
  // Uyanırken de soru yazılıp gönderilebilir (kuyruğa alınır); yalnızca kesin ulaşılamazlıkta kilitlenir.
  const inputLocked = health === "unreachable" || health === "unconfigured";

  // Ulaşılamazsa uyanma penceresi boyunca kendiliğinden yeniden dener (bkz. lib/health-watch.ts).
  const refreshHealth = useCallback(() => {
    stopHealthRef.current?.();
    stopHealthRef.current = watchHealth(checkHealth, (state) => onHealthRef.current(state));
  }, []);

  const updateTurn = (id: number, patch: Partial<Turn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Her render'da en güncel kapanışı ref'e yaz; izleyici geri çağrısı hep güncel durumu görsün.
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
    setView("preview");
    setQuestion("");
    setBoardOnly(false);
    // Kayıt veri seti oturumuna aittir; yeni veri setinde şerit sıfırdan başlar.
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
    // Modele giden şema: ana tablo + ek tablolar (sütun adı/tipi, onaylı örnek değerler) + eşleşen sütun çiftleri.
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
    // Her sorudan sonra bağlam varsayılana döner: bir sonraki soru bu yanıtın devamı sayılır.
    setContextChoice({ mode: "auto" });

    if (waking) {
      pendingRef.current = { id, question: q, schema, history };
      return;
    }
    void runTurn(id, q, schema, history);
  }

  /** Otomatik keşif: tarayıcıda kural tabanlı içgörüler, model çağrısı yok (bkz. lib/explore.ts). */
  async function explore() {
    const current = engine.current;
    if (!ready || !current || exploring) return;
    setExploring(true);
    setView("answers");
    try {
      const insights = await runExplore(current, ready.profile);
      if (engine.current !== current) return; // keşif sürerken veri seti kapatıldı
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

  function continueFrom(id: number) {
    setContextChoice({ mode: "turn", id });
    setView("answers");
    inputRef.current?.focus();
  }

  const header = (
    <header className="flex flex-wrap items-center gap-3 border-b bg-panel px-4 py-2.5">
      <button type="button" onClick={closeDataset} className="font-heading text-lg font-bold tracking-tight" aria-label="InsightFlow, başa dön">
        Insight<span className="text-local">Flow</span>
      </button>
      {ready && (
        <span className="flex min-w-0 items-center gap-1.5 rounded-md border bg-card py-1 pr-1 pl-2.5 text-sm">
          <span className="truncate font-medium">{ready.profile.name}</span>
          {extraTables.length > 0 && (
            <span className="shrink-0 rounded bg-local-soft px-1.5 py-0.5 text-[11px] font-medium text-local">+{extraTables.length} tablo</span>
          )}
          <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
            {formatInt(totalColumns)} sütun · {formatBytes(ready.sizeBytes)} · {formatInt(ready.profile.loadMs)} ms
          </span>
          <button
            type="button"
            onClick={closeDataset}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Veri setini kapat"
          >
            <X className="size-3.5" />
          </button>
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
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
      <div className="flex h-full flex-col">
        {header}
        <main className="flex-1 overflow-y-auto">
          {boardOnly ? (
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setBoardOnly(false)}
                  className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Geri
                </button>
                <h1 className="font-heading text-2xl font-medium">Pano</h1>
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

  const tabs: [View, string][] = [
    ["answers", `Yanıtlar${turns.length ? ` (${turns.length})` : ""}`],
    ["board", `Pano${pins?.length ? ` (${pins.length})` : ""}`],
    ["preview", "Veri önizlemesi"],
  ];

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside className="flex flex-col gap-6 border-b bg-panel p-4 lg:w-[22rem] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <button
            type="button"
            onClick={() => void explore()}
            disabled={exploring}
            className="flex items-center gap-3 rounded-lg border border-local/40 bg-local-soft/60 px-3 py-2.5 text-left transition-colors hover:border-local disabled:opacity-60"
          >
            {exploring ? <Loader2 className="size-5 shrink-0 animate-spin text-local" aria-hidden /> : <Compass className="size-5 shrink-0 text-local" aria-hidden />}
            <span className="flex flex-col">
              <span className="text-sm font-medium">{exploring ? "Keşfediliyor…" : "Veriyi keşfet"}</span>
              <span className="text-xs text-muted-foreground">Hazır içgörüler · yapay zekâ kullanılmaz</span>
            </span>
          </button>
          <section aria-labelledby="questions-heading" className="flex flex-col gap-2">
            <h2 id="questions-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Hemen sorabileceklerin
            </h2>
            <ul className="flex flex-col gap-1.5">
              {suggestions.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    disabled={busy || inputLocked}
                    onClick={() => void submit(q)}
                    className="w-full rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-foreground/30 disabled:opacity-50"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <TablesPanel
            tables={ready.tables}
            relationships={ready.relationships}
            selected={shownTable?.table ?? PRIMARY_TABLE}
            onSelect={setSelectedTable}
            onAddFiles={(files) => void addFiles(files)}
            onRemove={(table) => {
              if (selectedTable === table) setSelectedTable(PRIMARY_TABLE);
              // Çıkarılan tablonun paylaşılan örnek değerleri de düşer.
              setSharedValues((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith(`${table}.`))));
              void removeTable(table);
            }}
            reloading={ready.reloading}
            error={ready.addError}
          />
          <SchemaPanel profile={shownTable ?? ready.profile} />
        </aside>

        <main className="flex min-h-[75vh] min-w-0 flex-1 flex-col gap-3 p-4 lg:min-h-0">
          <div className="flex items-center justify-between gap-2">
            <div role="tablist" aria-label="Görünüm" className="flex rounded-md border bg-card p-0.5 text-sm">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => setView(key)}
                  className={cn(
                    "rounded px-3 py-1 whitespace-nowrap transition-colors",
                    view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "preview" && (
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {shownTable?.table} · ilk {formatInt((ready.previews[shownTable?.table ?? PRIMARY_TABLE] ?? ready.preview).rows.length)} /{" "}
                {formatInt(shownTable?.rowCount ?? ready.profile.rowCount)} satır
              </span>
            )}
          </div>

          {view === "preview" && (
            <PreviewTable
              key={shownTable?.table}
              result={ready.previews[shownTable?.table ?? PRIMARY_TABLE] ?? ready.preview}
              columns={(shownTable ?? ready.profile).columns}
              className="flex-1"
            />
          )}

          {view === "board" && (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <Pinboard pins={pins} unavailable={pinsUnavailable} />
            </div>
          )}

          {view === "answers" && (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {turns.length === 0 ? (
                <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
                  <Compass className="size-7 text-local" aria-hidden />
                  <p className="font-medium">Nereden başlayacağını bilmiyor musun?</p>
                  <p className="text-sm text-muted-foreground">
                    Keşif; trendleri, en büyük kategorileri, oran farklarını ve veri kalitesini tarayıcında çıkarır. Yapay zekâya hiçbir şey gönderilmez.
                  </p>
                  <button
                    type="button"
                    onClick={() => void explore()}
                    disabled={exploring}
                    className="mt-1 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    {exploring ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Compass className="size-4" aria-hidden />}
                    {exploring ? "Keşfediliyor…" : "Veriyi keşfet"}
                  </button>
                  <p className="text-xs text-muted-foreground">ya da soldaki önerilerden birine tıkla, aşağıya kendi sorunu yaz</p>
                </div>
              ) : (
                <div className="mx-auto flex max-w-4xl flex-col gap-6">
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

          {health === "waking" && (
            <div role="status" className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 shrink-0 animate-spin text-outbound" aria-hidden />
              <span>
                <span className="text-foreground">Yanıt motoru uyanıyor…</span> Ücretsiz sunucu boştayken uyku moduna geçiyor; bu
                genelde 30–50 saniye sürer. Sorunu şimdi gönderebilirsin; sunucu hazır olunca kendiliğinden işlenir.
              </span>
            </div>
          )}

          {(health === "unreachable" || health === "unconfigured") && (
            <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-sm">
              <span className="text-destructive">{HEALTH_MESSAGE[health]}</span>
              <button
                type="button"
                onClick={refreshHealth}
                className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-3" aria-hidden />
                Tekrar dene
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(question);
            }}
            className={cn("flex flex-col gap-2 rounded-lg border bg-card p-2 focus-within:border-foreground/30", inputLocked && "opacity-60")}
          >
            {contextQuestion && !inputLocked && (
              <div className="flex min-w-0 items-center gap-1.5 px-2 pt-0.5 text-xs">
                <CornerDownRight className="size-3.5 shrink-0 text-outbound" aria-hidden />
                <span className="shrink-0 text-muted-foreground">Önceki soruyla bağlantılı:</span>
                <span className="truncate font-medium" title={contextQuestion}>
                  &ldquo;{contextQuestion}&rdquo;
                </span>
                <button
                  type="button"
                  onClick={() => setContextChoice({ mode: "none" })}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Önceki soruyla bağlantıyı kaldır"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            {!contextQuestion && contextChoice.mode === "none" && autoContextId !== null && !inputLocked && (
              <button
                type="button"
                onClick={() => setContextChoice({ mode: "auto" })}
                className="flex items-center gap-1.5 self-start px-2 pt-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <CornerDownRight className="size-3.5" aria-hidden />
                Son soruya bağla
              </button>
            )}
            <label htmlFor="question" className="sr-only">
              Verine bir soru sor
            </label>
            <textarea
              id="question"
              ref={inputRef}
              rows={2}
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
              placeholder="Verine bir soru sor… (Enter ile gönder)"
              className="resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Modele <span className="text-outbound">{totalColumns} sütunun adı ve tipi</span>
                  {extraTables.length > 0 && ready.relationships.length > 0 && <> ve tablo ilişkileri</>}
                  {sharedCount > 0 && (
                    <>
                      {" "}+ <span className="text-outbound">{sharedCount} örnek değer</span>
                    </>
                  )}{" "}
                  gider.
                </span>
                <button type="button" onClick={() => setValuesDialogOpen(true)} className="underline underline-offset-2 hover:text-foreground">
                  {sharedCount > 0 ? "Örnek değerleri düzenle" : "Örnek değerleri paylaş"}
                </button>
                <button type="button" onClick={() => setPanelOpen(true)} className="underline underline-offset-2 hover:text-foreground">
                  Gönderilenleri gör
                </button>
              </span>
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  className="grid size-8 shrink-0 place-items-center rounded-md border bg-card text-foreground"
                  aria-label="Soruyu durdur"
                >
                  <Square className="size-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={question.trim().length < 2 || inputLocked}
                  className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
                  aria-label="Soruyu gönder"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
          </form>
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

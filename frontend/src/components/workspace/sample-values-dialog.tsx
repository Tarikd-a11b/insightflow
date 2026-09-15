"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_SHARED_VALUES, normalizeValues, sampleValueCandidates, type SharedValues } from "@/lib/data/sample-values";
import { PRIMARY_TABLE } from "@/lib/data/tables";
import type { ColumnProfile } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/** `key`: ana tabloda sütun adı, ek tablolarda `tablo.sütun` (paylaşılan değerlerin anahtarı). */
type Preview = { key: string; values: string[] };

export const sharedKey = (table: string, column: string) => (table === PRIMARY_TABLE ? column : `${table}.${column}`);

/**
 * Az kategorili sütunların değerlerini modele göndermek için onay penceresi. Gönderilecek değerlerin tamamı
 * önceden gösterilir; kullanıcı istediği sütunun işaretini kaldırabilir. Hiçbir şey onaysız gitmez.
 */
export function SampleValuesDialog({
  open,
  onClose,
  tables,
  shared,
  onChange,
  readValues,
}: {
  open: boolean;
  onClose: () => void;
  tables: { table: string; columns: ColumnProfile[] }[];
  shared: SharedValues;
  onChange: (next: SharedValues) => void;
  readValues: (table: string, column: string) => Promise<unknown[]>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Pencere her açıldığında değerler motordan (tarayıcıda) yeniden okunur; mevcut seçim korunur.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const candidates = tables.flatMap((t) => sampleValueCandidates(t.columns).map((c) => ({ table: t.table, column: c.name })));
    Promise.all(candidates.map(async (c) => ({ key: sharedKey(c.table, c.column), values: normalizeValues(await readValues(c.table, c.column)) })))
      .then((list) => {
        if (!alive) return;
        const usable = list.filter((p) => p.values.length > 0 && p.values.length <= MAX_SHARED_VALUES);
        setPreviews(usable);
        setSelected(new Set(Object.keys(shared).length ? Object.keys(shared) : usable.map((p) => p.key)));
        setError(null);
      })
      .catch(() => alive && setError("Değerler okunamadı."));
    return () => {
      alive = false;
    };
    // shared yalnızca açılıştaki başlangıç seçimi için okunur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tables, readValues]);

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  function share() {
    const next: SharedValues = {};
    for (const p of previews ?? []) if (selected.has(p.key)) next[p.key] = p.values;
    onChange(next);
    onClose();
  }

  const selectedCount = previews?.filter((p) => selected.has(p.key)).reduce((n, p) => n + p.values.length, 0) ?? 0;
  const active = Object.keys(shared).length > 0;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="sample-values-title"
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border bg-panel p-0 text-foreground backdrop:bg-black/40 open:animate-in open:fade-in open:zoom-in-95"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id="sample-values-title" className="font-heading text-xl font-medium">
              Örnek değerleri paylaş
            </h2>
            <p className="text-sm text-muted-foreground">
              Varsayılan olarak modele yalnızca sütun adları ve tipleri gider. Az sayıda kategorisi olan sütunların değerlerini de
              paylaşırsan model filtreleri doğru yazımla kurar ve &ldquo;net kâr&rdquo; gibi soruları daha iyi yanıtlar.{" "}
              <span className="text-foreground">Yalnızca aşağıda işaretlediğin değerler gider.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Pencereyi kapat"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!error && previews === null && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Değerler tarayıcında okunuyor…
            </p>
          )}
          {previews?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Bu veri setinde paylaşılabilecek az kategorili metin sütunu yok (en fazla {MAX_SHARED_VALUES} farklı değer, kimlik sütunları hariç).
            </p>
          )}
          {previews && previews.length > 0 && (
            <ul className="flex flex-col gap-2">
              {previews.map((p) => {
                const checked = selected.has(p.key);
                return (
                  <li key={p.key}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors",
                        checked ? "border-outbound/50" : "opacity-70",
                      )}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(p.key)} className="mt-1 size-4 accent-[var(--outbound)]" />
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className="font-mono text-[13px]">
                          {p.key} <span className="text-muted-foreground">· {p.values.length} değer</span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {p.values.map((v) => (
                            <span key={v} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                              {v}
                            </span>
                          ))}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {selectedCount > 0 ? `Modele ${selectedCount} değer gidecek` : "Hiçbir değer seçilmedi"}
          </span>
          {active && (
            <button
              type="button"
              onClick={() => {
                onChange({});
                onClose();
              }}
              className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-muted"
            >
              Paylaşmayı kapat
            </button>
          )}
          <button
            type="button"
            onClick={share}
            disabled={!previews || selectedCount === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            Seçilenleri paylaş
          </button>
        </footer>
      </div>
    </dialog>
  );
}

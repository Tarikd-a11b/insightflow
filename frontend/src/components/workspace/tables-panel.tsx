"use client";

import { Link2, Loader2, Plus, Table2, X } from "lucide-react";
import { useRef } from "react";
import { formatInt } from "@/lib/format";
import { MAX_EXTRA_TABLES, PRIMARY_TABLE, type Relationship } from "@/lib/data/tables";
import type { TableProfile } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 0 });

/**
 * Veri setindeki tablolar ve tarayıcıda bulunan birleştirme ilişkileri. Ek dosyalar yeni tablolar olarak eklenir;
 * model bu tabloların yalnızca adlarını, sütunlarını ve eşleşen sütun çiftlerini görür.
 */
export function TablesPanel({
  tables,
  relationships,
  selected,
  onSelect,
  onAddFiles,
  onRemove,
  reloading,
  error,
}: {
  tables: TableProfile[];
  relationships: Relationship[];
  selected: string;
  onSelect: (table: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemove: (table: string) => void;
  reloading: boolean;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canAdd = tables.length <= MAX_EXTRA_TABLES && !reloading;

  return (
    <section aria-labelledby="tables-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tables-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Tablolar
        </h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canAdd}
          className="flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {reloading ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Plus className="size-3" aria-hidden />}
          {reloading ? "Yükleniyor…" : "Dosya ekle"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.parquet,.xlsx,.xls"
          className="sr-only"
          tabIndex={-1}
          aria-label="Tablo olarak dosya ekle"
          data-add-table
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) onAddFiles(files);
            e.target.value = "";
          }}
        />
      </div>

      <ul className="flex flex-col gap-1" role="listbox" aria-label="Şeması gösterilecek tablo">
        {tables.map((t) => {
          const active = t.table === selected;
          return (
            <li key={t.table} className="flex items-center gap-1">
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(t.table)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                  active ? "border-foreground/30 bg-card" : "border-transparent hover:bg-card",
                )}
              >
                <Table2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono text-[13px]">{t.table}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{formatInt(t.rowCount)} satır</span>
              </button>
              {t.table !== PRIMARY_TABLE && (
                <button
                  type="button"
                  onClick={() => onRemove(t.table)}
                  disabled={reloading}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  aria-label={`${t.table} tablosunu çıkar`}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {tables.length === 1 && (
        <p className="text-xs text-muted-foreground">
          İlişkili bir dosya (ör. müşteri listesi) eklersen tablolar arasında birleştirme yapan sorular sorabilirsin.
        </p>
      )}

      {tables.length > 1 && (
        <div className="flex flex-col gap-1" aria-label="Tablolar arası ilişkiler">
          {relationships.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tablolar arasında ortak sütun bulunamadı; birleştirme için aynı adlı bir anahtar sütun (ör. musteri_id) gerekir.
            </p>
          ) : (
            relationships.map((r) => (
              <p key={`${r.left.table}.${r.left.column}-${r.right.table}.${r.right.column}`} className="flex items-start gap-1.5 text-xs" data-relationship>
                <Link2 className="mt-0.5 size-3.5 shrink-0 text-local" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  {/* Dar kenar çubuğunda kesilmesin diye iki satır: anahtarlar tam görünür. */}
                  <span className="font-mono text-[11px] break-all">
                    {r.left.table}.{r.left.column} ↔ {r.right.table}.{r.right.column}
                  </span>
                  <span className="text-muted-foreground" title="Sol tablodaki anahtarların sağ tabloda bulunma oranı (tarayıcıda hesaplandı)">
                    {pct.format(r.coverage)} eşleşme
                  </span>
                </span>
              </p>
            ))
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

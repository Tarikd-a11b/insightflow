import type { ColumnProfile, QueryResult } from "@/lib/data/types";
import { formatCell } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  result: QueryResult;
  /** Veri seti profili varsa sayı ve kimlik sütunları oradan, yoksa değerlerden çıkarılır. */
  columns?: ColumnProfile[];
  className?: string;
}

function inferNumeric(result: QueryResult): Set<string> {
  return new Set(
    result.columns.filter((col) => {
      const sample = result.rows.find((r) => r[col] !== null && r[col] !== undefined)?.[col];
      return typeof sample === "number";
    }),
  );
}

export function PreviewTable({ result, columns, className }: Props) {
  const numeric = columns
    ? new Set(columns.filter((c) => c.kind === "numeric").map((c) => c.name))
    : inferNumeric(result);
  // Kimlik sütunları sayı gibi biçimlenmez (100.001 değil 100001).
  const ids = new Set(columns?.filter((c) => c.identifier).map((c) => c.name) ?? []);

  return (
    <div className={cn("min-h-0 overflow-auto rounded-lg border bg-card", className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            {result.columns.map((col) => (
              <th
                key={col}
                scope="col"
                className={cn(
                  "border-b px-3 py-2 font-mono text-xs font-medium whitespace-nowrap text-muted-foreground",
                  numeric.has(col) ? "text-right" : "text-left",
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/50">
              {result.columns.map((col) => {
                const v = row[col];
                return (
                  <td
                    key={col}
                    className={cn(
                      "border-b border-border/50 px-3 py-1.5 whitespace-nowrap",
                      numeric.has(col) && "text-right font-mono tabular-nums",
                      v === null && "text-muted-foreground",
                    )}
                  >
                    {ids.has(col) && v !== null ? String(v) : formatCell(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

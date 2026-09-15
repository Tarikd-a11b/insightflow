const int = new Intl.NumberFormat("tr-TR");
const dec = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

export const formatInt = (n: number) => int.format(n);

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? int.format(value) : dec.format(value);
  if (typeof value === "boolean") return value ? "doğru" : "yanlış";
  return String(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${dec.format(bytes / 1024)} KB`;
  return `${dec.format(bytes / 1024 ** 2)} MB`;
}

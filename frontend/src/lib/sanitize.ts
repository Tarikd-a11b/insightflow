/**
 * DuckDB hata mesajlarından veri değerlerini temizler (backend/src/insightflow/sanitize.py ile aynı kurallar).
 * Onarım isteği sunucuya gitmeden önce tarayıcıda uygulanır; sunucu da ayrıca temizler.
 */
const MAX_ERROR_LENGTH = 600;
const SINGLE_QUOTED = /'(?:[^']|'')*'/g;
const NUMBER = /(?<![\w"])-?\d+(?:[.,]\d+)?(?![\w"])/g;
const LINE_PREFIX = /^LINE \d+:/;

export function sanitizeError(message: string): string {
  const text = message
    .replace(SINGLE_QUOTED, "'…'")
    .split(/\r?\n/)
    .map((line) => {
      const head = line.match(LINE_PREFIX)?.[0] ?? "";
      return head + line.slice(head.length).replace(NUMBER, "#");
    })
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.slice(0, MAX_ERROR_LENGTH);
}

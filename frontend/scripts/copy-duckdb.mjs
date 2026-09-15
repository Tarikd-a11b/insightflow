// DuckDB-WASM dosyalarını ve kullandığımız eklentileri public/duckdb altına koyar; motor çalışma anında
// yalnızca uygulamanın kendi alan adından dosya çeker.
//
// Neden eklentiler de: DuckDB-WASM parquet okurken `parquet` eklentisini varsayılan olarak
// extensions.duckdb.org'dan indirir. Bu hem üçüncü taraf bir sunucuya fark edilmeden istek atmak demek, hem de
// CSP'deki `connect-src 'self' <api>` kısıtıyla engellenir. Eklentiyi derlemede indirip kendimiz sunuyoruz.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const dest = join(root, "public", "duckdb");

// DuckDB çekirdek sürümü (paket sürümü değil). duckdb-wasm yükseltilince güncelle; uyuşmazsa E2E testleri düşer.
export const DUCKDB_CORE_VERSION = "v1.5.4";
const EXTENSIONS = ["parquet", "json"];
const PLATFORMS = ["wasm_eh", "wasm_mvp"];

const files = ["duckdb-mvp.wasm", "duckdb-eh.wasm", "duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"];
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`duckdb-wasm: ${files.length} dosya kopyalandı`);

for (const platform of PLATFORMS) {
  const dir = join(dest, "extensions", DUCKDB_CORE_VERSION, platform);
  mkdirSync(dir, { recursive: true });
  for (const ext of EXTENSIONS) {
    const file = join(dir, `${ext}.duckdb_extension.wasm`);
    if (existsSync(file) && statSync(file).size > 0) continue;
    const url = `https://extensions.duckdb.org/${DUCKDB_CORE_VERSION}/${platform}/${ext}.duckdb_extension.wasm`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Eklenti indirilemedi (${res.status}): ${url}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`duckdb eklentisi indirildi: ${platform}/${ext}`);
  }
}

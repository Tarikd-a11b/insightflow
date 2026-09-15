// Tarayıcı içi performans ölçümü: gerçek arayüz + gerçek DuckDB-WASM, Chromium'da.
// Sorgu üretim adımı sabit SQL ile taklit edilir (model gecikmesi ölçüme karışmasın diye);
// ölçülen süre, arayüzün gösterdiği "sorgu N ms" değeridir: DuckDB çalıştırma + Arrow → JS dönüşümü.
//
// Önkoşul: `uv run python scripts/generate_bench_data.py` (backend/) ve çalışan frontend.
// Çalıştırma: node scripts/benchmark.mjs [--url http://localhost:3000] [--runs 5]

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL_ = arg("url", "http://localhost:3000");
const RUNS = Number(arg("runs", 5));
const SIZES = [100_000, 1_000_000, 5_000_000];

export const QUERIES = {
  aylik_trend: "SELECT date_trunc('month', siparis_tarihi) AS ay, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1 ORDER BY 1",
  kategori_sehir_top20:
    "SELECT kategori, sehir, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1, 2 ORDER BY ciro DESC LIMIT 20",
  iade_orani: "SELECT kategori, AVG(CASE WHEN iade_edildi THEN 1 ELSE 0 END) AS iade_orani FROM data GROUP BY 1 ORDER BY 2 DESC",
  kanal_medyan: "SELECT kanal, MEDIAN(toplam_tutar) AS medyan, QUANTILE_CONT(toplam_tutar, 0.9) AS p90 FROM data GROUP BY 1",
  sehir_basina_lider_kategori: `SELECT sehir, kategori, ciro FROM (
      SELECT sehir, kategori, SUM(toplam_tutar) AS ciro,
             ROW_NUMBER() OVER (PARTITION BY sehir ORDER BY SUM(toplam_tutar) DESC) AS rn
      FROM data GROUP BY 1, 2) WHERE rn = 1 ORDER BY ciro DESC`,
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const num = (text) => Number(text.replace(/\./g, "").replace(",", "."));

async function benchSize(browser, n) {
  const file = join(root, "bench-data", `ecom_${n}.parquet`);
  if (!existsSync(file)) throw new Error(`${file} yok; önce generate_bench_data.py çalıştırın`);

  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  let pendingSql = "";
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/health") return route.fulfill({ json: { status: "ok", llm_configured: true } });
    return route.fulfill({ json: { status: "ok", sql: pendingSql, explanation: "bench", chart: "table", limited: false } });
  });

  await page.goto(URL_);
  // Motorun WASM derlemesi tarayıcı önbelleğine girsin: ilk yükleme ısınma, ikincisi ölçüm.
  const load = async () => {
    await page.locator("input[type=file]").setInputFiles(file);
    await page.getByRole("tab", { name: "Veri önizlemesi" }).waitFor({ timeout: 300_000 });
    const chip = await page.locator("header").first().innerText();
    return num(chip.match(/([\d.]+) ms/)[1]);
  };
  const coldLoadMs = await load();
  await page.getByRole("button", { name: "Veri setini kapat" }).click();
  await page.getByText("Verini bırak.").waitFor();
  const loadMs = await load();

  const results = {};
  let asked = 0;
  for (const [name, sql] of Object.entries(QUERIES)) {
    const times = [];
    for (let r = 0; r < RUNS + 1; r++) {
      pendingSql = sql;
      asked++;
      await page.locator("#question").fill(`bench ${name} ${r}`);
      await page.keyboard.press("Enter");
      const card = page.locator("article").nth(asked - 1);
      const meta = card.getByText(/^sorgu [\d.]+ ms$/);
      await meta.waitFor({ timeout: 120_000 });
      const ms = num((await meta.innerText()).match(/([\d.]+) ms/)[1]);
      if (r > 0) times.push(ms); // ilk koşu ısınma
    }
    results[name] = { median_ms: median(times), min_ms: Math.min(...times), max_ms: Math.max(...times) };
    process.stdout.write(`  ${n.toLocaleString("tr-TR")} satır · ${name}: medyan ${results[name].median_ms} ms\n`);
  }
  await page.close();
  return { rows: n, cold_load_ms: coldLoadMs, load_ms: loadMs, queries: results };
}

const browser = await chromium.launch();
const version = browser.version();
const out = { date: new Date().toISOString(), browser: `Chromium ${version}`, cpu: cpus()[0].model, cores: cpus().length, ram_gb: Math.round(totalmem() / 1024 ** 3), runs: RUNS, sizes: [] };
for (const n of SIZES) {
  try {
    out.sizes.push(await benchSize(browser, n));
  } catch (err) {
    console.error(`  ${n} satır başarısız: ${err.message}`);
    out.sizes.push({ rows: n, error: err.message });
  }
}
await browser.close();

mkdirSync(join(root, "docs", "benchmark"), { recursive: true });
writeFileSync(join(root, "docs", "benchmark", "browser.json"), JSON.stringify(out, null, 2));
console.log("docs/benchmark/browser.json yazıldı");

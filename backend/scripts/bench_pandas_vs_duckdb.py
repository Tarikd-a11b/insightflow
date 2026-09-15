"""pandas ile DuckDB'yi aynı veri ve aynı 5 analitik sorgu üzerinde karşılaştırır.

Her (motor, veri boyutu) ayrı bir alt süreçte koşar; böylece en yüksek bellek (Windows: peak working set,
diğer sistemlerde ru_maxrss) motorlar arasında karışmaz. Her sorgu 1 ısınma + 5 ölçüm, medyan raporlanır.
İki motor da veriyi belleğe alır (pandas DataFrame / DuckDB bellek içi tablo), tıpkı uygulamadaki gibi.

Çalıştırma: uv run python scripts/bench_pandas_vs_duckdb.py
Çıktı: ../docs/benchmark/python.json
"""

from __future__ import annotations

import json
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "bench-data"
SIZES = [100_000, 1_000_000, 5_000_000]
RUNS = 5

DUCKDB_SQL = {
    "aylik_trend": "SELECT date_trunc('month', siparis_tarihi) AS ay, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1 ORDER BY 1",
    "kategori_sehir_top20": "SELECT kategori, sehir, SUM(toplam_tutar) AS ciro FROM data GROUP BY 1, 2 ORDER BY ciro DESC LIMIT 20",
    "iade_orani": "SELECT kategori, AVG(CASE WHEN iade_edildi THEN 1 ELSE 0 END) AS iade_orani FROM data GROUP BY 1 ORDER BY 2 DESC",
    "kanal_medyan": "SELECT kanal, MEDIAN(toplam_tutar) AS medyan, QUANTILE_CONT(toplam_tutar, 0.9) AS p90 FROM data GROUP BY 1",
    "sehir_basina_lider_kategori": """SELECT sehir, kategori, ciro FROM (
        SELECT sehir, kategori, SUM(toplam_tutar) AS ciro,
               ROW_NUMBER() OVER (PARTITION BY sehir ORDER BY SUM(toplam_tutar) DESC) AS rn
        FROM data GROUP BY 1, 2) WHERE rn = 1 ORDER BY ciro DESC""",
}


def pandas_queries(df):
    import pandas as pd

    def aylik_trend():
        return df.groupby(df["siparis_tarihi"].dt.to_period("M"))["toplam_tutar"].sum().sort_index()

    def kategori_sehir_top20():
        return df.groupby(["kategori", "sehir"])["toplam_tutar"].sum().nlargest(20)

    def iade_orani():
        return df.groupby("kategori")["iade_edildi"].mean().sort_values(ascending=False)

    def kanal_medyan():
        return df.groupby("kanal")["toplam_tutar"].agg(medyan="median", p90=lambda s: s.quantile(0.9))

    def sehir_basina_lider_kategori():
        g = df.groupby(["sehir", "kategori"], as_index=False)["toplam_tutar"].sum()
        return g.sort_values("toplam_tutar", ascending=False).groupby("sehir").head(1)

    _ = pd  # sorgular pandas API'sini kullanır
    return {f.__name__: f for f in [aylik_trend, kategori_sehir_top20, iade_orani, kanal_medyan, sehir_basina_lider_kategori]}


def peak_memory_mb() -> float:
    import psutil

    info = psutil.Process().memory_info()
    peak = getattr(info, "peak_wset", None)  # Windows
    if peak is None:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux: KB
    return peak / 1024**2


def worker(engine: str, n: int) -> dict:
    path = DATA / f"ecom_{n}.parquet"
    baseline = peak_memory_mb()
    started = time.perf_counter()
    if engine == "pandas":
        import pandas as pd

        df = pd.read_parquet(path)
        df["siparis_tarihi"] = pd.to_datetime(df["siparis_tarihi"])
        load_ms = (time.perf_counter() - started) * 1000
        runners = pandas_queries(df)
    else:
        import duckdb

        con = duckdb.connect()
        con.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{path.as_posix()}')")
        load_ms = (time.perf_counter() - started) * 1000
        runners = {name: (lambda sql=sql: con.execute(sql).fetchall()) for name, sql in DUCKDB_SQL.items()}

    queries = {}
    for name, run in runners.items():
        run()  # ısınma
        times = []
        for _ in range(RUNS):
            t = time.perf_counter()
            run()
            times.append((time.perf_counter() - t) * 1000)
        queries[name] = round(statistics.median(times), 1)
    return {
        "engine": engine,
        "rows": n,
        "load_ms": round(load_ms, 1),
        "queries_median_ms": queries,
        "peak_memory_mb": round(peak_memory_mb(), 1),
        "baseline_memory_mb": round(baseline, 1),
    }


def main() -> None:
    results = []
    for n in SIZES:
        for engine in ["pandas", "duckdb"]:
            proc = subprocess.run(
                [sys.executable, __file__, "--worker", engine, str(n)], capture_output=True, text=True, encoding="utf-8"
            )
            if proc.returncode != 0:
                print(f"{engine} {n}: HATA\n{proc.stderr[-800:]}")
                continue
            r = json.loads(proc.stdout.strip().splitlines()[-1])
            results.append(r)
            total = sum(r["queries_median_ms"].values())
            print(f"{n:>9,} {engine:<7} yükleme {r['load_ms']:>8.0f} ms · 5 sorgu toplam {total:>8.1f} ms · tepe bellek {r['peak_memory_mb']:>7.0f} MB")

    import duckdb
    import pandas

    out = {
        "date": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "processor": platform.processor(),
        "pandas": pandas.__version__,
        "duckdb": duckdb.__version__,
        "runs": RUNS,
        "results": results,
    }
    target = ROOT / "docs" / "benchmark" / "python.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{target.relative_to(ROOT)} yazıldı")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--worker":
        print(json.dumps(worker(sys.argv[2], int(sys.argv[3]))))
    else:
        main()

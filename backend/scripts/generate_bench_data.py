"""Benchmark için büyük sentetik e-ticaret veri setleri üretir (demo verisiyle aynı şema).

Çalıştırma: uv run python scripts/generate_bench_data.py [satır sayıları...]
Çıktı: ../bench-data/ecom_<n>.parquet  (git'e girmez)
"""

import sys
import time
from pathlib import Path

import duckdb

OUT = Path(__file__).resolve().parents[2] / "bench-data"
SIZES = [int(s) for s in sys.argv[1:]] or [100_000, 1_000_000, 5_000_000]

SQL = """
COPY (
  SELECT
    i::BIGINT + 100000 AS siparis_id,
    DATE '2024-01-01' + CAST(floor(random() * 730) AS INTEGER) AS siparis_tarihi,
    (['İstanbul','Ankara','İzmir','Bursa','Antalya','Adana','Konya','Gaziantep'])[1 + CAST(floor(random() * 8) AS INTEGER)] AS sehir,
    (['Elektronik','Giyim','Ev & Yaşam','Kozmetik','Kitap','Spor'])[1 + CAST(floor(random() * 6) AS INTEGER)] AS kategori,
    (['Mobil Uygulama','Web','Pazaryeri'])[1 + CAST(floor(random() * 3) AS INTEGER)] AS kanal,
    (['Yeni','Sadık','Kurumsal'])[1 + CAST(floor(random() * 3) AS INTEGER)] AS musteri_segmenti,
    1 + CAST(floor(random() * 4) AS INTEGER) AS adet,
    round(40 + random() * 5000, 2) AS birim_fiyat,
    (0.05 * floor(random() * 5))::DOUBLE AS indirim_orani,
    round((40 + random() * 5000) * (1 + floor(random() * 4)), 2) AS toplam_tutar,
    random() < 0.07 AS iade_edildi
  FROM range({n}) t(i)
) TO '{path}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 122880)
"""

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    con = duckdb.connect()
    con.execute("SELECT setseed(0.42)")
    for n in SIZES:
        path = OUT / f"ecom_{n}.parquet"
        started = time.perf_counter()
        con.execute(SQL.format(n=n, path=path.as_posix()))
        print(f"{path.name}: {n:,} satır, {path.stat().st_size / 1024 ** 2:.1f} MB, {time.perf_counter() - started:.1f} sn")

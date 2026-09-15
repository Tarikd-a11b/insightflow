"""Takip sorularının gerçek modelle değerlendirmesi: ilk soru → SQL → takip sorusu (geçmişle) → SQL.

Her zincirin son SQL'i gerçek DuckDB'de çalıştırılır ve beklenen değişikliği içerip içermediği basit
bir denetimle kontrol edilir (ör. 2025 filtresi eklendi mi, kırılım korunuyor mu).

Çalıştırma: uv run python scripts/eval_followup.py
"""

import asyncio
import io
import sys
from pathlib import Path

import duckdb

from insightflow.config import settings
from insightflow.llm import GeminiSqlGenerator, QueryContext
from insightflow.schemas import ColumnSchema, HistoryItem, SqlAnswer
from insightflow.service import answer

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
DEMO = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"

# (veri seti, ilk soru, takip sorusu, son SQL'de bulunması gereken parçalar)
CHAINS = [
    ("eticaret_satis.parquet", "Kategori bazında toplam ciro nedir?", "Sadece 2025 için", ["kategori", "2025"]),
    ("eticaret_satis.parquet", "Aylara göre toplam ciro nasıl değişti?", "Bunu kanal bazında kır", ["kanal", "date_trunc"]),
    ("saas_musteri_churn.parquet", "Plan bazında churn oranı nedir?", "Aynısını bölgeye göre yap", ["bolge", "churn_oldu"]),
]


async def main() -> None:
    generator = GeminiSqlGenerator(settings.gemini_api_key or "", settings.gemini_model_list)
    passed = 0
    for file, first, follow, expected in CHAINS:
        con = duckdb.connect()
        con.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{(DEMO / file).as_posix()}')")
        columns = [ColumnSchema(name=n, type=t) for n, t, *_ in con.execute("DESCRIBE data").fetchall()]

        r1 = await answer(generator, QueryContext(first, columns))
        assert isinstance(r1, SqlAnswer), r1
        r2 = await answer(generator, QueryContext(follow, columns, [HistoryItem(question=first, sql=r1.sql)]))
        if not isinstance(r2, SqlAnswer):
            print(f"✗ {first!r} → {follow!r}: yanıtlanamaz ({r2.reason})")
            continue
        rows = con.execute(r2.sql).fetchall()
        sql_lower = r2.sql.lower()
        missing = [part for part in expected if part.lower() not in sql_lower]
        ok = not missing and rows
        passed += bool(ok)
        print(f"{'✓' if ok else '✗'} {first!r} → {follow!r}: {len(rows)} satır{'; eksik: ' + ', '.join(missing) if missing else ''}")
        print(f"   {r2.explanation}")
        print("   " + r2.sql.replace("\n", " ")[:240])
        con.close()
    print(f"\nÖZET: {passed}/{len(CHAINS)} takip zinciri beklenen değişikliği uyguladı")


if __name__ == "__main__":
    asyncio.run(main())

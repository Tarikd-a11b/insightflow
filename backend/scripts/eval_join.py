"""Çok tablolu soruların gerçek modelle değerlendirmesi (siparisler = data, musteriler = ek tablo).

Arayüzdeki akışın aynısı: modele ana tablo sütunları + ek tablo sütunları + ilişki gider; dönen SQL gerçek DuckDB'de
iki tablo üzerinde çalıştırılır (hata olursa en fazla 3 onarım). Her soru için JOIN'in gerekip gerekmediği kontrol edilir.

Çalıştırma: uv run python scripts/eval_join.py
"""

import asyncio
import io
import sys
from pathlib import Path

import duckdb

from insightflow.config import settings
from insightflow.llm import GeminiSqlGenerator, PreviousAttempt, QueryContext
from insightflow.schemas import ColumnSchema, Relationship, SqlAnswer, TableSchema
from insightflow.service import SqlGenerationFailed, answer

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
DEMO = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"

# (soru, JOIN gerekli mi)
CASES = [
    ("Hangi segmentteki müşteriler en çok harcıyor?", True),
    ("Şehir bazında müşteri başına ortalama harcama nedir?", True),
    ("Yaş grubuna göre Elektronik kategorisindeki toplam tutar nedir?", True),
    ("Aylara göre toplam sipariş tutarı nasıl değişti?", False),
    ("Müşteri kaydı bulunmayan siparişlerin toplam tutarı nedir?", True),
]


def columns_of(con: duckdb.DuckDBPyConnection, table: str) -> list[ColumnSchema]:
    return [ColumnSchema(name=n, type=t) for n, t, *_ in con.execute(f"DESCRIBE {table}").fetchall()]


async def main() -> None:
    con = duckdb.connect()
    con.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{(DEMO / 'siparisler.parquet').as_posix()}')")
    con.execute(f"CREATE TABLE musteriler AS SELECT * FROM read_parquet('{(DEMO / 'musteriler.parquet').as_posix()}')")
    con.execute("SET enable_external_access = false")
    base = dict(
        columns=columns_of(con, "data"),
        tables=[TableSchema(name="musteriler", columns=columns_of(con, "musteriler"))],
        relationships=[Relationship(left="data.musteri_id", right="musteriler.musteri_id")],
    )
    generator = GeminiSqlGenerator(settings.gemini_api_key or "", settings.gemini_model_list)

    passed = 0
    for question, needs_join in CASES:
        previous: PreviousAttempt | None = None
        status = "başarısız"
        for attempt in range(4):
            try:
                result = await answer(generator, QueryContext(question, **base), previous)
            except SqlGenerationFailed as err:
                status = f"güvenli sorgu üretilemedi ({err.last_code})"
                break
            if not isinstance(result, SqlAnswer):
                status = f"yanıtlanamaz: {result.reason}"
                break
            try:
                rows = con.execute(result.sql).fetchall()
            except duckdb.Error as err:
                previous = PreviousAttempt(sql=result.sql, error=str(err))
                continue
            uses_join = "join" in result.sql.lower() or "musteriler" in result.sql.lower()
            ok = bool(rows) and uses_join == needs_join
            passed += ok
            status = f"{'✓' if ok else '✗'} {len(rows)} satır · onarım={attempt} · JOIN={'var' if uses_join else 'yok'} (beklenen: {'var' if needs_join else 'yok'})"
            print(f"- {question}\n   {status}\n   {result.explanation}\n   {result.sql.replace(chr(10), ' ')[:260]}\n   örnek: {rows[:2]}")
            break
        else:
            print(f"- {question}\n   ✗ 3 onarımdan sonra da çalışmadı")
            continue
        if not status.startswith(("✓", "✗")):
            print(f"- {question}\n   ✗ {status}")
    print(f"\nÖZET: {passed}/{len(CASES)} soru doğru tablo kullanımıyla çalıştı")


if __name__ == "__main__":
    asyncio.run(main())

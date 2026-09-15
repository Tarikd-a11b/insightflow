"""Gerçek modelle uçtan uca değerlendirme: soru → doğrulanmış SQL → DuckDB'de çalıştırma → gerekirse onarım.

Tarayıcıdaki akışın aynısını (en fazla 3 onarım) Python DuckDB ile taklit eder ve başarı oranını,
onarım sayılarını ve süreleri raporlar. Sonuçlar Faz 5 benchmark'ına girdi olur.

Çalıştırma: uv run python scripts/eval_llm.py
"""

import asyncio
import io
import sys
import time
from pathlib import Path

import duckdb

from insightflow.config import settings
from insightflow.llm import GeminiSqlGenerator, PreviousAttempt
from insightflow.schemas import ColumnSchema, SqlAnswer
from insightflow.service import SqlGenerationFailed, answer

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
DEMO = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"
MAX_REPAIRS = 3

CASES = {
    "eticaret_satis.parquet": [
        "Aylara göre toplam ciro nasıl değişti?",
        "Kasım kampanyası hangi kategoriyi büyüttü?",
        "Kategori bazında iade oranı nedir?",
        "En çok satış yapılan 5 şehir hangisi?",
        "Mobil uygulamadan gelen siparişlerin ortalama sepet tutarı web'den yüksek mi?",
        "İndirim oranı arttıkça adet artıyor mu?",
        # Bir modelin JSON içinde çift tırnaklı sütun adını kaçıramayıp kesik SQL döndürdüğü soru.
        "Toplam sipariş sayısı ve ortalama sepet tutarı nedir?",
        "Aylara göre kanal bazında ciro",
    ],
    "saas_musteri_churn.parquet": [
        "Hangi planda müşteri kaybı en yüksek?",
        "NPS puanı düşük müşterilerin churn oranı yüksek mi?",
        "Bölgelere göre aylık toplam gelir nedir?",
        "Son girişten bu yana 30 günden fazla geçen kaç müşteri var?",
    ],
    "finans_gelir_gider.parquet": [
        "Aylık net kâr nasıl değişti?",
        "En büyük gider kalemi hangisi?",
        "2025'te departman bazında toplam gider nedir?",
        "Yarın dolar kaç olacak?",
    ],
}


async def main() -> None:
    generator = GeminiSqlGenerator(settings.gemini_api_key or "", settings.gemini_model_list)
    stats = {"ok": 0, "unanswerable": 0, "failed": 0, "repairs": 0, "total": 0}
    for file, questions in CASES.items():
        con = duckdb.connect()
        con.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{(DEMO / file).as_posix()}')")
        con.execute("SET enable_external_access = false")
        columns = [ColumnSchema(name=n, type=t) for n, t, *_ in con.execute("DESCRIBE data").fetchall()]
        print(f"\n=== {file}")
        for q in questions:
            stats["total"] += 1
            started = time.perf_counter()
            previous: PreviousAttempt | None = None
            outcome = "failed"
            for attempt in range(MAX_REPAIRS + 1):
                try:
                    result = await answer(generator, q, columns, previous)
                except SqlGenerationFailed as err:
                    outcome = f"güvenli sorgu üretilemedi ({err.last_code})"
                    break
                if not isinstance(result, SqlAnswer):
                    outcome = f"yanıtlanamaz: {result.reason}"
                    stats["unanswerable"] += 1
                    break
                try:
                    rows = con.execute(result.sql).fetchall()
                except duckdb.Error as err:
                    stats["repairs"] += 1
                    previous = PreviousAttempt(sql=result.sql, error=str(err))
                    print(f"   onarım {attempt + 1}: {str(err).splitlines()[0][:120]}")
                    continue
                outcome = f"ok · {len(rows)} satır · {result.chart} · onarım={attempt}"
                stats["ok"] += 1
                sample = rows[:2]
                break
            ms = round((time.perf_counter() - started) * 1000)
            if outcome == "failed":
                stats["failed"] += 1
            print(f"- {q}\n   {outcome} · {ms} ms")
            if outcome.startswith("ok"):
                print("   " + result.sql.replace("\n", " ")[:220])
                print(f"   örnek: {sample}")
        con.close()
    print(f"\nÖZET: {stats}")


if __name__ == "__main__":
    asyncio.run(main())

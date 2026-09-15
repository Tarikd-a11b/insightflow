"""Soru → doğrulanmış SQL akışı.

Doğrulayıcının reddettiği SQL kullanıcıya hiç gösterilmez: ret nedeni modele geri beslenir ve
yeni sorgu istenir (en fazla MAX_VALIDATION_ROUNDS tur). Tarayıcıdaki çalışma hatalarının
onarımı ise istemci tarafından /repair ile yürütülür.
"""

from __future__ import annotations

import logging
import time

from insightflow.llm import PreviousAttempt, SqlGenerator
from insightflow.sanitize import sanitize_error
from insightflow.schemas import ColumnSchema, SqlAnswer, Unanswerable
from insightflow.validator import UnsafeSqlError, validate_sql

log = logging.getLogger(__name__)

MAX_VALIDATION_ROUNDS = 3


class SqlGenerationFailed(RuntimeError):
    def __init__(self, last_code: str):
        super().__init__("Güvenli bir sorgu üretilemedi.")
        self.last_code = last_code


async def answer(
    generator: SqlGenerator,
    question: str,
    columns: list[ColumnSchema],
    previous: PreviousAttempt | None = None,
) -> SqlAnswer | Unanswerable:
    if previous is not None:
        # İstemci zaten temizliyor; sunucu tarafında da temizlemek savunmayı istemciye bağımlı bırakmaz.
        previous = PreviousAttempt(sql=previous.sql, error=sanitize_error(previous.error))

    last_code = "unknown"
    for round_no in range(1, MAX_VALIDATION_ROUNDS + 1):
        started = time.perf_counter()
        output = await generator.generate(question, columns, previous, attempt=round_no)
        elapsed_ms = round((time.perf_counter() - started) * 1000)

        if not output.answerable:
            log.info("yanıtlanamaz soru, tur=%d, %d ms", round_no, elapsed_ms)
            return Unanswerable(reason=output.reason or "Bu soru mevcut sütunlarla yanıtlanamıyor.")

        try:
            validated = validate_sql(output.sql)
        except UnsafeSqlError as err:
            last_code = err.code
            log.warning("doğrulama reddi, tur=%d, kod=%s, sql=%r", round_no, err.code, output.sql[:500])
            previous = PreviousAttempt(sql=output.sql, error=f"Güvenlik doğrulaması reddetti: {err}")
            continue

        log.info("sql üretildi, tur=%d, %d ms, sql=%r", round_no, elapsed_ms, validated.sql[:500])
        return SqlAnswer(
            sql=validated.sql,
            explanation=output.explanation,
            chart=output.chart,
            limited=validated.limited,
        )

    raise SqlGenerationFailed(last_code)

import logging
from functools import lru_cache

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from insightflow.config import settings
from insightflow.llm import GeminiSqlGenerator, LlmUnavailableError, PreviousAttempt, SqlGenerator, Summarizer
from insightflow.ratelimit import SlidingWindowLimiter
from insightflow.schemas import RepairRequest, SqlAnswer, SqlRequest, SummaryAnswer, SummaryRequest, Unanswerable
from insightflow.service import SqlGenerationFailed, answer
from insightflow.summary import NotAggregatedError, ensure_aggregated

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="InsightFlow API",
    description="Durumsuz API: doğal dil soru + tablo şeması alır, doğrulanmış DuckDB SQL döner. "
    "Veri satırı kabul etmez ve saklamaz.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

limiter = SlidingWindowLimiter(settings.rate_limit_requests, settings.rate_limit_window_seconds)


@lru_cache
def _gemini() -> GeminiSqlGenerator:
    return GeminiSqlGenerator(settings.gemini_api_key or "", settings.gemini_model_list)


def get_generator() -> SqlGenerator:
    if not settings.gemini_api_key:
        raise HTTPException(503, "Yapay zekâ servisi yapılandırılmamış (GEMINI_API_KEY yok).")
    return _gemini()


def client_key(request: Request) -> str:
    # Render/Vercel gibi vekil sunucuların arkasında gerçek istemci ilk X-Forwarded-For adresidir.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limited(request: Request) -> None:
    retry_after = limiter.check(client_key(request))
    if retry_after is not None:
        raise HTTPException(
            429,
            f"Çok fazla soru gönderildi. {int(retry_after // 60) + 1} dakika sonra tekrar deneyin.",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )


async def _run(generator: SqlGenerator, coro_args: dict) -> SqlAnswer | Unanswerable:
    try:
        return await answer(generator, **coro_args)
    except SqlGenerationFailed as err:
        raise HTTPException(422, "Bu soru için güvenli bir sorgu üretilemedi. Soruyu farklı ifade etmeyi deneyin.") from err
    except LlmUnavailableError as err:
        raise HTTPException(502, "Yapay zekâ servisine şu an ulaşılamıyor. Biraz sonra tekrar deneyin.") from err


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "llm_configured": settings.gemini_api_key is not None}


@app.post("/sql", response_model=SqlAnswer | Unanswerable, dependencies=[Depends(rate_limited)])
async def generate_sql(body: SqlRequest, generator: SqlGenerator = Depends(get_generator)):
    return await _run(generator, {"question": body.question, "columns": body.columns})


def get_summarizer() -> Summarizer:
    if not settings.gemini_api_key:
        raise HTTPException(503, "Yapay zekâ servisi yapılandırılmamış (GEMINI_API_KEY yok).")
    return _gemini()


@app.post("/summary", response_model=SummaryAnswer, dependencies=[Depends(rate_limited)])
async def summarize(body: SummaryRequest, summarizer: Summarizer = Depends(get_summarizer)):
    try:
        ensure_aggregated(body.sql)
    except NotAggregatedError as err:
        raise HTTPException(422, str(err)) from err
    try:
        text = await summarizer.summarize(body.question, body.columns, body.rows)
    except LlmUnavailableError as err:
        raise HTTPException(502, "Yapay zekâ servisine şu an ulaşılamıyor. Biraz sonra tekrar deneyin.") from err
    return SummaryAnswer(summary=text)


@app.post("/repair", response_model=SqlAnswer | Unanswerable, dependencies=[Depends(rate_limited)])
async def repair_sql(body: RepairRequest, generator: SqlGenerator = Depends(get_generator)):
    previous = PreviousAttempt(sql=body.sql, error=body.error)
    return await _run(generator, {"question": body.question, "columns": body.columns, "previous": previous})

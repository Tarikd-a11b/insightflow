from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

ChartKind = Literal["line", "bar", "scatter", "kpi", "table"]

_CONTROL_CHARS = {chr(c) for c in range(32)} - {"\t"}


MAX_SAMPLE_VALUES = 12
SampleValue = Annotated[str, StringConstraints(min_length=1, max_length=60)]


class ColumnSchema(BaseModel):
    """LLM'e giden sütun bilgisi: ad ve tip. `values` yalnızca kullanıcı az kategorili bir sütunun değerlerini
    paylaşmayı açıkça seçtiyse gelir (varsayılan: yok)."""

    name: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    type: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_(), \[\]]+$")]
    values: Annotated[list[SampleValue], Field(max_length=MAX_SAMPLE_VALUES)] | None = None

    @field_validator("name")
    @classmethod
    def no_control_chars(cls, v: str) -> str:
        if any(ch in _CONTROL_CHARS for ch in v):
            raise ValueError("Sütun adı kontrol karakteri içeremez.")
        return v

    @field_validator("values")
    @classmethod
    def clean_values(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if any(ch in _CONTROL_CHARS for value in v for ch in value):
            raise ValueError("Örnek değer kontrol karakteri içeremez.")
        return v or None


Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
Columns = Annotated[list[ColumnSchema], Field(min_length=1, max_length=300)]


class SqlRequest(BaseModel):
    question: Question
    columns: Columns


class RepairRequest(BaseModel):
    question: Question
    columns: Columns
    sql: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    error: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    attempt: Annotated[int, Field(ge=1, le=3)]


class SqlAnswer(BaseModel):
    status: Literal["ok"] = "ok"
    sql: str
    explanation: str
    chart: ChartKind
    limited: bool


class Unanswerable(BaseModel):
    status: Literal["unanswerable"] = "unanswerable"
    reason: str


Cell = Annotated[str, StringConstraints(max_length=120)] | float | int | bool | None


class SummaryRequest(BaseModel):
    question: Question
    sql: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    columns: Annotated[list[Annotated[str, StringConstraints(min_length=1, max_length=128)]], Field(min_length=1, max_length=8)]
    rows: Annotated[list[list[Cell]], Field(min_length=1, max_length=20)]

    @field_validator("rows")
    @classmethod
    def rows_match_columns(cls, rows: list[list[object]], info) -> list[list[object]]:
        width = len(info.data.get("columns") or [])
        if any(len(r) != width for r in rows):
            raise ValueError("Her satır sütun sayısı kadar değer içermeli.")
        return rows


class SummaryAnswer(BaseModel):
    summary: str


class LlmSummaryOutput(BaseModel):
    summary: str = Field(description="En fazla iki cümlelik Türkçe yönetici özeti.")


class LlmSqlOutput(BaseModel):
    """Modelden istenen yapılandırılmış çıktı."""

    answerable: bool = Field(description="Soru verilen sütunlarla yanıtlanabiliyor mu?")
    sql: str = Field(description="Tek bir DuckDB SELECT sorgusu; yanıtlanamıyorsa boş.")
    explanation: str = Field(description="Sorgunun ne yaptığını anlatan tek Türkçe cümle.")
    chart: ChartKind = Field(description="Sonuç için en uygun görünüm.")
    reason: str = Field(description="Yanıtlanamıyorsa kısa Türkçe neden; yanıtlanabiliyorsa boş.")

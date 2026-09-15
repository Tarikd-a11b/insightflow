"""LLM'in ürettiği SQL için AST tabanlı güvenlik doğrulaması.

Tehdit modeli: SQL'i yazan LLM'dir; sütun adlarına gömülü bir prompt injection veya bir
halüsinasyon dosya/ağ okuyan, ayar değiştiren ya da birden çok ifade içeren SQL üretebilir.
Tarayıcıdaki motor ayrıca kilitli olduğu için bu katman tek savunma değil, ilk savunmadır.

Kurallar:
1. Tek ifade, kökü SELECT veya küme işlemi (UNION/INTERSECT/EXCEPT).
2. Tablo izin listesi: yalnızca `data` ve sorgunun kendi tanımladığı CTE'ler; şema/katalog
   niteliği, dosya yolu veya tablo fonksiyonu yok.
3. Fonksiyon izin listesi: analitik fonksiyonlar dışında her şey reddedilir
   (read_csv, glob, getenv, current_setting, duckdb_* ...).
4. Sonuç satırı sınırı: LIMIT yoksa eklenir, fazlaysa düşürülür.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

TABLE_NAME = "data"
MAX_ROWS = 1000
MAX_SQL_LENGTH = 4000

ALLOWED_FUNCTIONS = frozenset(
    """
    COUNT SUM AVG MIN MAX MEDIAN MODE STDDEV STDDEV_POP STDDEV_SAMP VARIANCE VAR_POP VAR_SAMP
    CORR COVAR_POP COVAR_SAMP REGR_SLOPE REGR_INTERCEPT REGR_R2 QUANTILE_CONT QUANTILE_DISC
    PERCENTILE_CONT PERCENTILE_DISC APPROX_COUNT_DISTINCT APPROX_QUANTILE ARG_MAX ARG_MIN ARGMAX
    ARGMIN MAX_BY MIN_BY BOOL_AND BOOL_OR LOGICAL_AND LOGICAL_OR COUNT_IF COUNTIF STRING_AGG
    LISTAGG GROUP_CONCAT ARRAY_AGG LIST FIRST LAST ANY_VALUE ENTROPY KURTOSIS SKEWNESS
    ROW_NUMBER RANK DENSE_RANK PERCENT_RANK CUME_DIST NTILE LAG LEAD FIRST_VALUE LAST_VALUE NTH_VALUE
    ABS ROUND CEIL CEILING FLOOR TRUNC SQRT POW POWER EXP LN LOG LOG10 LOG2 SIGN GREATEST LEAST MOD PI
    CASE COALESCE NULLIF IF IFNULL IIF CAST TRY_CAST EXISTS
    LOWER UPPER LENGTH TRIM LTRIM RTRIM SUBSTRING SUBSTR REPLACE CONCAT CONCAT_WS LEFT RIGHT STRPOS
    POSITION CONTAINS STARTS_WITH ENDS_WITH SPLIT_PART REGEXP_MATCHES REGEXP_REPLACE REGEXP_EXTRACT
    LPAD RPAD REVERSE LIKE ILIKE
    DATE_TRUNC DATE_PART DATEPART EXTRACT YEAR MONTH DAY QUARTER WEEK WEEKOFYEAR DAYOFWEEK DAYOFMONTH
    DAYOFYEAR ISODOW HOUR MINUTE SECOND DATE_DIFF DATEDIFF DATE_SUB DATE_ADD STRFTIME STRPTIME
    MAKE_DATE TO_TIMESTAMP EPOCH AGE LAST_DAY MONTHNAME DAYNAME CURRENT_DATE CURRENT_TIMESTAMP NOW
    TIME_BUCKET INTERVAL TO_DAYS TO_MONTHS TO_YEARS
    """.split()
)

_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


class UnsafeSqlError(ValueError):
    """SQL güvenlik kurallarını ihlal ediyor. `code` makine için, mesaj LLM ve kullanıcı için."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ValidatedSql:
    sql: str
    limited: bool  # LIMIT eklendi veya düşürüldü mü


def _function_name(node: exp.Func) -> str:
    # sqlglot bilinen fonksiyonları kendi sınıflarına çevirir (read_csv -> ReadCSV); DuckDB
    # diyalektinde yeniden üretip baştaki adı almak, sınıf adlarını tek tek eşlemekten güvenli.
    rendered = node.sql(dialect="duckdb")
    match = _NAME_RE.match(rendered)
    return match.group(0).upper() if match else ""


def _cte_names(root: exp.Expression) -> set[str]:
    return {cte.alias_or_name.lower() for cte in root.find_all(exp.CTE)}


def _enforce_limit(root: exp.Query) -> tuple[exp.Query, bool]:
    limit = root.args.get("limit")
    if limit is None:
        return root.limit(MAX_ROWS), True
    value = limit.expression
    if isinstance(value, exp.Literal) and value.is_int and int(value.this) <= MAX_ROWS:
        return root, False
    return root.limit(MAX_ROWS), True


def validate_sql(sql: str) -> ValidatedSql:
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise UnsafeSqlError("empty", "SQL boş.")
    if len(text) > MAX_SQL_LENGTH:
        raise UnsafeSqlError("too_long", f"SQL {MAX_SQL_LENGTH} karakterden uzun olamaz.")

    try:
        statements = [s for s in sqlglot.parse(text, read="duckdb") if s is not None]
    except ParseError as err:
        raise UnsafeSqlError("parse_error", f"SQL ayrıştırılamadı: {str(err).splitlines()[0]}") from err

    if len(statements) != 1:
        raise UnsafeSqlError("multiple_statements", "Yalnızca tek bir SQL ifadesine izin verilir.")
    root = statements[0]

    if not isinstance(root, (exp.Select, exp.SetOperation)):
        raise UnsafeSqlError(
            "not_select", f"Yalnızca SELECT sorgularına izin verilir (gelen: {root.key.upper()})."
        )

    allowed_tables = {TABLE_NAME} | _cte_names(root)
    for node in root.walk():
        if isinstance(node, exp.Table):
            if not isinstance(node.this, exp.Identifier):
                raise UnsafeSqlError("table_function", "FROM içinde tablo fonksiyonu kullanılamaz; yalnızca `data` tablosu.")
            if node.args.get("db") or node.args.get("catalog"):
                raise UnsafeSqlError("qualified_table", "Tablo adı şema veya katalog ile nitelenemez.")
            if node.name.lower() not in allowed_tables:
                raise UnsafeSqlError("unknown_table", f"`{node.name}` tablosuna erişilemez; yalnızca `data` kullanılabilir.")
        elif isinstance(node, exp.Func) and not isinstance(node, (exp.Binary, exp.Connector)):
            # AND/OR gibi araya yazılan operatörler sqlglot'ta Func sayılır ama fonksiyon çağrısı değildir.
            name = _function_name(node)
            if name not in ALLOWED_FUNCTIONS:
                raise UnsafeSqlError("function_not_allowed", f"`{name.lower()}` fonksiyonuna izin verilmiyor.")
        elif isinstance(node, (exp.Command, exp.Into, exp.Lock)):
            raise UnsafeSqlError("not_select", "Sorgu içinde yan etkili ifade kullanılamaz.")

    limited_root, limited = _enforce_limit(root)
    return ValidatedSql(sql=limited_root.sql(dialect="duckdb", pretty=True), limited=limited)

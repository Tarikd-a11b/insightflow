"""SQL doğrulayıcı testleri.

İki korpus: (1) saldırı sorguları — hepsi reddedilmeli; (2) gerçekçi analitik sorgular —
hepsi kabul edilmeli VE doğrulanmış hâli gerçek DuckDB'de demo verisi üzerinde çalışmalı.
"""

from pathlib import Path

import duckdb
import pytest

from insightflow.validator import MAX_ROWS, UnsafeSqlError, validate_sql

DEMO = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo" / "eticaret_satis.parquet"

ATTACKS = {
    # yazma / şema değişikliği
    "drop": "DROP TABLE data",
    "delete": "DELETE FROM data",
    "update": "UPDATE data SET adet = 0",
    "insert": "INSERT INTO data SELECT * FROM data",
    "create_as": "CREATE TABLE x AS SELECT * FROM data",
    "alter": "ALTER TABLE data ADD COLUMN x INT",
    "select_into": "SELECT * INTO kopya FROM data",
    # çoklu ifade ve gizleme
    "stacked": "SELECT 1; DROP TABLE data",
    "stacked_comment": "SELECT * FROM data /* zararsız */; DELETE FROM data",
    "stacked_newline": "SELECT sehir FROM data;\nATTACH 'x.db'",
    # motor / ortam
    "set": "SET enable_external_access = true",
    "reset": "RESET lock_configuration",
    "pragma": "PRAGMA database_list",
    "attach": "ATTACH 'hedef.db' AS h",
    "install": "INSTALL httpfs",
    "load": "LOAD httpfs",
    "copy_out": "COPY data TO 'sizinti.csv'",
    "export": "EXPORT DATABASE 'yedek'",
    "describe": "DESCRIBE data",
    "call": "CALL pragma_version()",
    "checkpoint": "CHECKPOINT",
    # dosya / ağ okuma
    "read_csv": "SELECT * FROM read_csv('/etc/passwd')",
    "read_csv_auto": "SELECT * FROM read_csv_auto('C:/Users/x/gizli.csv')",
    "read_parquet_s3": "SELECT * FROM read_parquet('s3://kova/veri.parquet')",
    "read_json": "SELECT * FROM read_json('https://kotu.site/x.json')",
    "read_text": "SELECT read_text('/etc/hosts')",
    "read_blob": "SELECT * FROM read_blob('*.db')",
    "glob": "SELECT * FROM glob('*')",
    "string_path": "SELECT * FROM 'gizli.csv'",
    "quoted_path": 'SELECT * FROM "gizli.parquet"',
    "dotted_path": "SELECT * FROM gizli.csv",
    "file_in_subquery": "SELECT * FROM data WHERE sehir IN (SELECT column0 FROM read_csv('x.csv'))",
    "file_in_cte": "WITH x AS (SELECT * FROM read_csv('x.csv')) SELECT * FROM x",
    "file_in_union": "SELECT sehir FROM data UNION ALL SELECT content FROM read_text('a.txt')",
    "file_in_join": "SELECT * FROM data JOIN read_csv('x.csv') r ON true",
    # meta veri ve ortam sızıntısı
    "getenv": "SELECT getenv('GEMINI_API_KEY')",
    "current_setting": "SELECT current_setting('home_directory')",
    "duckdb_settings": "SELECT * FROM duckdb_settings()",
    "duckdb_tables": "SELECT * FROM duckdb_tables()",
    "information_schema": "SELECT * FROM information_schema.tables",
    "qualified_data": "SELECT * FROM main.data",
    "sqlite_master": "SELECT * FROM sqlite_master",
    "other_table": "SELECT * FROM kullanicilar",
    "query_fn": "SELECT * FROM query('SELECT 1')",
    # boş / bozuk
    "empty": "   ",
    "garbage": "SELEC sehir FROM",
    "too_long": "SELECT " + ", ".join(["sehir"] * 1000) + " FROM data",
}

LEGIT = {
    "monthly_trend": """SELECT date_trunc('month', siparis_tarihi) AS ay, SUM(toplam_tutar) AS toplam
                        FROM data GROUP BY 1 ORDER BY 1""",
    "top_categories": "SELECT kategori, SUM(toplam_tutar) AS ciro FROM data GROUP BY kategori ORDER BY ciro DESC LIMIT 5",
    "return_rate": "SELECT kategori, AVG(CASE WHEN iade_edildi THEN 1 ELSE 0 END) AS iade_orani FROM data GROUP BY ALL",
    "cte": """WITH aylik AS (SELECT date_trunc('month', siparis_tarihi) ay, SUM(toplam_tutar) t FROM data GROUP BY 1)
              SELECT ay, t, t - LAG(t) OVER (ORDER BY ay) AS degisim FROM aylik ORDER BY ay""",
    "window_rank": """SELECT sehir, kategori, ciro FROM (
                        SELECT sehir, kategori, SUM(toplam_tutar) ciro,
                               ROW_NUMBER() OVER (PARTITION BY sehir ORDER BY SUM(toplam_tutar) DESC) rn
                        FROM data GROUP BY sehir, kategori) WHERE rn = 1""",
    "qualify": """SELECT sehir, kategori, SUM(toplam_tutar) ciro FROM data GROUP BY sehir, kategori
                  QUALIFY RANK() OVER (PARTITION BY sehir ORDER BY ciro DESC) = 1""",
    "percentiles": "SELECT MEDIAN(toplam_tutar), QUANTILE_CONT(toplam_tutar, 0.9), STDDEV(toplam_tutar) FROM data",
    "filter_clause": "SELECT COUNT(*) FILTER (WHERE iade_edildi) AS iade, COUNT(*) AS toplam FROM data",
    "corr": "SELECT CORR(birim_fiyat, toplam_tutar) FROM data",
    "extract_strftime": "SELECT EXTRACT(year FROM siparis_tarihi) yil, strftime(siparis_tarihi, '%m') ay, COUNT(*) FROM data GROUP BY ALL",
    "interval": "SELECT COUNT(*) FROM data WHERE siparis_tarihi >= DATE '2025-12-31' - INTERVAL 30 DAY",
    "casts": "SELECT CAST(adet AS DOUBLE) / 2, TRY_CAST(sehir AS INTEGER), adet::VARCHAR FROM data",
    "string_fns": "SELECT UPPER(sehir), LENGTH(kategori), COALESCE(NULLIF(kanal, ''), 'yok') FROM data WHERE sehir ILIKE 'i%'",
    "union": "SELECT 'Web' k, COUNT(*) FROM data WHERE kanal = 'Web' UNION ALL SELECT 'Diğer', COUNT(*) FROM data WHERE kanal <> 'Web'",
    "quoted_identifier": 'SELECT "sehir", SUM("toplam_tutar") FROM "data" GROUP BY "sehir"',
    "trailing_semicolon": "SELECT COUNT(*) FROM data;",
    "subquery_exists": "SELECT COUNT(*) FROM data d WHERE EXISTS (SELECT 1 FROM data x WHERE x.sehir = d.sehir AND x.adet > 3)",
    "rounding": "SELECT sehir, ROUND(AVG(toplam_tutar), 2) FROM data GROUP BY sehir HAVING COUNT(*) > 100",
}


@pytest.mark.parametrize("sql", ATTACKS.values(), ids=ATTACKS.keys())
def test_attack_is_rejected(sql):
    with pytest.raises(UnsafeSqlError):
        validate_sql(sql)


@pytest.fixture(scope="module")
def con():
    c = duckdb.connect()
    c.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{DEMO.as_posix()}')")
    c.execute("SET enable_external_access = false")
    yield c
    c.close()


@pytest.mark.parametrize("sql", LEGIT.values(), ids=LEGIT.keys())
def test_legit_query_is_accepted_and_runs(sql, con):
    validated = validate_sql(sql)
    rows = con.execute(validated.sql).fetchall()
    assert len(rows) <= MAX_ROWS


def test_limit_added_when_missing():
    result = validate_sql("SELECT sehir FROM data")
    assert result.limited
    assert f"LIMIT {MAX_ROWS}" in result.sql


def test_small_limit_kept():
    result = validate_sql("SELECT sehir FROM data LIMIT 5")
    assert not result.limited
    assert "LIMIT 5" in result.sql


def test_large_limit_reduced():
    result = validate_sql("SELECT sehir FROM data LIMIT 999999")
    assert result.limited
    assert f"LIMIT {MAX_ROWS}" in result.sql


def test_error_codes_are_specific():
    cases = {
        "SELECT 1; SELECT 2": "multiple_statements",
        "DROP TABLE data": "not_select",
        "SELECT * FROM read_csv('x')": "table_function",
        "SELECT getenv('X')": "function_not_allowed",
        "SELECT * FROM baska": "unknown_table",
        "SELECT * FROM main.data": "qualified_table",
    }
    for sql, code in cases.items():
        with pytest.raises(UnsafeSqlError) as err:
            validate_sql(sql)
        assert err.value.code == code, sql


# --- Kullanıcının eklediği tablolar (JOIN) ---

EXTRA = ["musteriler"]


def test_join_with_declared_extra_table_is_accepted_and_runs(con):
    con.execute(
        "CREATE OR REPLACE TABLE musteriler AS SELECT * FROM (VALUES ('İstanbul', 'Kurumsal'), ('Ankara', 'Yeni')) t(sehir, segment)"
    )
    sql = """SELECT m.segment, SUM(d.toplam_tutar) AS ciro
             FROM data d JOIN musteriler m ON d.sehir = m.sehir
             GROUP BY 1 ORDER BY 2 DESC"""
    validated = validate_sql(sql, EXTRA)
    assert len(con.execute(validated.sql).fetchall()) == 2


@pytest.mark.parametrize(
    "sql, code",
    [
        ("SELECT * FROM musteriler", "unknown_table"),  # listede yok
        ("SELECT * FROM data d JOIN kullanicilar k ON true", "unknown_table"),
        ("SELECT * FROM main.musteriler", "qualified_table"),
        ("SELECT * FROM data d JOIN read_csv('x.csv') r ON true", "table_function"),
    ],
    ids=["extra_not_declared", "other_unknown", "qualified_extra", "file_join"],
)
def test_extra_tables_do_not_open_other_access(sql, code):
    extra = [] if "musteriler" in sql and "main." not in sql else EXTRA
    with pytest.raises(UnsafeSqlError) as err:
        validate_sql(sql, extra)
    assert err.value.code == code
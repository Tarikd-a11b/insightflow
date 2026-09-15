import pytest
from fastapi.testclient import TestClient

from insightflow import main
from insightflow.ratelimit import SlidingWindowLimiter
from insightflow.summary import NotAggregatedError, ensure_aggregated

AGGREGATED = {
    "group_by": 'SELECT "kategori", SUM("toplam_tutar") AS ciro FROM data GROUP BY 1 ORDER BY 2 DESC LIMIT 10',
    "global_agg": "SELECT COUNT(*) AS n, AVG(toplam_tutar) AS ort FROM data",
    "cte_then_select": "WITH a AS (SELECT sehir, SUM(toplam_tutar) t FROM data GROUP BY 1) SELECT * FROM a ORDER BY t DESC",
    "subquery_agg": "SELECT * FROM (SELECT kanal, COUNT(*) n FROM data GROUP BY kanal) q",
    "union_both_agg": "SELECT 'a' k, COUNT(*) FROM data UNION ALL SELECT 'b', SUM(adet) FROM data",
    "window_over_group": "SELECT ay, t, t - LAG(t) OVER (ORDER BY ay) FROM (SELECT date_trunc('month', d) ay, SUM(x) t FROM data GROUP BY 1)",
}

RAW = {
    "plain_select": "SELECT * FROM data",
    "filtered_rows": "SELECT musteri_id, tutar FROM data WHERE tutar > 100",
    "window_only": "SELECT sehir, SUM(toplam_tutar) OVER (PARTITION BY sehir) FROM data",
    "agg_in_where_subquery": "SELECT * FROM data WHERE toplam_tutar > (SELECT AVG(toplam_tutar) FROM data)",
    "union_one_raw": "SELECT 'a', COUNT(*) FROM data UNION ALL SELECT sehir, adet FROM data",
    "scalar_subquery_column": "SELECT sehir, (SELECT COUNT(*) FROM data) FROM data",
    "unsafe": "SELECT * FROM read_csv('x.csv')",
}


@pytest.mark.parametrize("sql", AGGREGATED.values(), ids=AGGREGATED.keys())
def test_aggregated_sql_is_accepted(sql):
    ensure_aggregated(sql)


@pytest.mark.parametrize("sql", RAW.values(), ids=RAW.keys())
def test_row_level_sql_is_rejected(sql):
    with pytest.raises(NotAggregatedError):
        ensure_aggregated(sql)


class FakeSummarizer:
    def __init__(self):
        self.calls = []

    async def summarize(self, question, columns, rows):
        self.calls.append((question, columns, rows))
        return "Elektronik %45 payla ilk sırada."


@pytest.fixture
def client():
    main.limiter = SlidingWindowLimiter(100, 60)
    fake = FakeSummarizer()
    main.app.dependency_overrides[main.get_summarizer] = lambda: fake
    yield TestClient(main.app), fake
    main.app.dependency_overrides.clear()


BODY = {
    "question": "Kategori bazında ciro?",
    "sql": AGGREGATED["group_by"],
    "columns": ["kategori", "ciro"],
    "rows": [["Elektronik", 3078642.31], ["Giyim", 642596.71]],
}


def test_summary_endpoint(client):
    c, fake = client
    res = c.post("/summary", json=BODY)
    assert res.status_code == 200
    assert res.json()["summary"].startswith("Elektronik")
    assert fake.calls[0][2] == BODY["rows"]


def test_summary_rejects_raw_rows_without_calling_model(client):
    c, fake = client
    res = c.post("/summary", json={**BODY, "sql": RAW["plain_select"]})
    assert res.status_code == 422
    assert fake.calls == []


@pytest.mark.parametrize(
    "patch",
    [
        {"rows": [["x", 1]] * 21},
        {"columns": [f"c{i}" for i in range(9)], "rows": [[1] * 9]},
        {"rows": [["Elektronik"]]},
        {"rows": [["a" * 121, 1]]},
        {"rows": [[{"nested": 1}, 1]]},
    ],
    ids=["too_many_rows", "too_many_columns", "ragged_row", "long_text", "nested_value"],
)
def test_summary_payload_limits(client, patch):
    c, fake = client
    res = c.post("/summary", json={**BODY, **patch})
    assert res.status_code == 422
    assert fake.calls == []


def test_join_summary_requires_aggregation_on_every_real_table():
    ensure_aggregated(
        "SELECT m.segment, SUM(d.tutar) AS ciro FROM data d JOIN musteriler m ON d.musteri_id = m.musteri_id GROUP BY 1",
        ["musteriler"],
    )
    with pytest.raises(NotAggregatedError):
        ensure_aggregated("SELECT m.sehir, d.tutar FROM data d JOIN musteriler m ON d.musteri_id = m.musteri_id", ["musteriler"])
    with pytest.raises(NotAggregatedError):
        # Ek tablodan ham satırlar UNION koluyla sızdırılamaz.
        ensure_aggregated("SELECT 'x', COUNT(*) FROM data UNION ALL SELECT sehir, 1 FROM musteriler", ["musteriler"])
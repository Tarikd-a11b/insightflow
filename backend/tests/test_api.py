import json

import pytest
from fastapi.testclient import TestClient

from insightflow import main
from insightflow.llm import PreviousAttempt, build_user_content
from insightflow.ratelimit import SlidingWindowLimiter
from insightflow.sanitize import sanitize_error
from insightflow.schemas import ColumnSchema, LlmSqlOutput

COLUMNS = [{"name": "sehir", "type": "VARCHAR"}, {"name": "toplam_tutar", "type": "DOUBLE"}]


def ok(sql: str, chart="bar") -> LlmSqlOutput:
    return LlmSqlOutput(answerable=True, sql=sql, explanation="Şehirlere göre toplam.", chart=chart, reason="")


class FakeGenerator:
    """Sırayla hazır yanıtlar döner ve her çağrının girdisini kaydeder."""

    def __init__(self, *outputs: LlmSqlOutput):
        self.outputs = list(outputs)
        self.calls: list[tuple[str, list[ColumnSchema], PreviousAttempt | None]] = []
        self.attempts: list[int] = []

    async def generate(self, question, columns, previous=None, attempt=1):
        self.attempts.append(attempt)
        self.calls.append((question, columns, previous))
        return self.outputs.pop(0)


@pytest.fixture
def client():
    main.limiter = SlidingWindowLimiter(100, 60)
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def use(generator):
    main.app.dependency_overrides[main.get_generator] = lambda: generator
    return generator


def test_sql_returns_validated_sql_with_limit(client):
    use(FakeGenerator(ok('SELECT "sehir", SUM("toplam_tutar") AS toplam FROM data GROUP BY 1')))
    res = client.post("/sql", json={"question": "Şehir bazında toplam?", "columns": COLUMNS})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "LIMIT 1000" in body["sql"]
    assert body["limited"] is True
    assert body["chart"] == "bar"


def test_unsafe_sql_is_fed_back_and_never_returned(client):
    gen = use(FakeGenerator(ok("SELECT * FROM read_csv('/etc/passwd')"), ok("SELECT COUNT(*) AS adet FROM data", "kpi")))
    res = client.post("/sql", json={"question": "Kaç kayıt var?", "columns": COLUMNS})
    assert res.status_code == 200
    assert "read_csv" not in res.text
    assert len(gen.calls) == 2
    assert "Güvenlik doğrulaması reddetti" in gen.calls[1][2].error


def test_gives_up_after_three_unsafe_rounds(client):
    bad = ok("DROP TABLE data")
    gen = use(FakeGenerator(bad, bad, bad))
    res = client.post("/sql", json={"question": "Tabloyu sil", "columns": COLUMNS})
    assert res.status_code == 422
    assert "DROP" not in res.text
    assert len(gen.calls) == 3
    # Her tur farklı deneme numarasıyla çağrılır; üretici bununla model/sıcaklık değiştirir.
    assert gen.attempts == [1, 2, 3]


def test_unanswerable_question(client):
    use(FakeGenerator(LlmSqlOutput(answerable=False, sql="", explanation="", chart="table", reason="Veride hava durumu yok.")))
    res = client.post("/sql", json={"question": "Yarın yağmur yağacak mı?", "columns": COLUMNS})
    assert res.json() == {"status": "unanswerable", "reason": "Veride hava durumu yok."}


def test_repair_sanitizes_error_before_llm(client):
    gen = use(FakeGenerator(ok('SELECT CAST("sehir" AS VARCHAR) FROM data')))
    res = client.post(
        "/repair",
        json={
            "question": "Şehirler",
            "columns": COLUMNS,
            "sql": 'SELECT CAST("sehir" AS INTEGER) FROM data',
            "error": "Conversion Error: Could not convert string 'Ahmet Yılmaz' to INT32",
            "attempt": 1,
        },
    )
    assert res.status_code == 200
    sent_error = gen.calls[0][2].error
    assert "Ahmet" not in sent_error
    assert "INT32" in sent_error


def test_repair_attempt_is_capped(client):
    use(FakeGenerator())
    res = client.post(
        "/repair", json={"question": "x?", "columns": COLUMNS, "sql": "SELECT 1", "error": "e", "attempt": 4}
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    "payload",
    [
        {"question": "", "columns": COLUMNS},
        {"question": "a" * 501, "columns": COLUMNS},
        {"question": "Soru?", "columns": []},
        {"question": "Soru?", "columns": [{"name": "a\nb", "type": "VARCHAR"}]},
        {"question": "Soru?", "columns": [{"name": "a", "type": "VARCHAR'; DROP"}]},
        {"question": "Soru?", "columns": COLUMNS, "rows": [["İstanbul", 1]]},
    ],
    ids=["empty_question", "long_question", "no_columns", "control_char", "bad_type", "extra_rows_ignored"],
)
def test_input_validation(client, payload):
    gen = use(FakeGenerator(ok("SELECT 1 AS x FROM data")))
    res = client.post("/sql", json=payload)
    if "rows" in payload:
        # Fazladan alanlar kabul edilir ama modele asla iletilmez.
        assert res.status_code == 200
        assert "İstanbul" not in build_user_content(*gen.calls[0])
    else:
        assert res.status_code == 422


def test_rate_limit(client):
    main.limiter = SlidingWindowLimiter(2, 60)
    use(FakeGenerator(*[ok("SELECT 1 AS x FROM data")] * 3))
    body = {"question": "Soru?", "columns": COLUMNS}
    assert client.post("/sql", json=body).status_code == 200
    assert client.post("/sql", json=body).status_code == 200
    res = client.post("/sql", json=body)
    assert res.status_code == 429
    assert "Retry-After" in res.headers


def test_llm_payload_contains_only_schema_and_question():
    content = json.loads(build_user_content("Toplam?", [ColumnSchema(name="sehir", type="VARCHAR")], None))
    assert content == {"columns": [{"name": "sehir", "type": "VARCHAR"}], "question": "Toplam?"}


def test_sliding_window_expires():
    now = [0.0]
    limiter = SlidingWindowLimiter(1, 10, clock=lambda: now[0])
    assert limiter.check("a") is None
    assert limiter.check("a") is not None
    assert limiter.check("b") is None
    now[0] = 10.5
    assert limiter.check("a") is None


@pytest.mark.parametrize(
    "raw, leaked",
    [
        ("Conversion Error: Could not convert string 'Ayşe Kaya' to INT32", "Ayşe"),
        ("Out of Range Error: value 18425075 is out of range for INT16", "18425075"),
        ("Invalid Input Error: date field value out of range: \"2024-13-45\"", None),
        ("Binder Error: Referenced column \"tutar\" not found. Candidate bindings: \"toplam_tutar\"", None),
    ],
)
def test_sanitize_error(raw, leaked):
    cleaned = sanitize_error(raw)
    if leaked:
        assert leaked not in cleaned
    if "Binder" in raw:
        assert '"toplam_tutar"' in cleaned

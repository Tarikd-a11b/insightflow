from fastapi.testclient import TestClient

from insightflow.main import app


def test_health_returns_ok():
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.api import api_router
from src.db.session import get_db


@pytest.fixture()
def client(db_session):
    app = FastAPI()
    app.include_router(api_router)
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_get_returns_default(client):
    r = client.get("/workbench", headers={"userid": "u1"})
    assert r.status_code == 200 and r.json()["tabOrder"] == ["dashboard"]


def test_put_then_get_roundtrip(client):
    cfg = {"dashboard": {"widgets": []}, "htmlTabs": [], "tabOrder": ["dashboard"], "activeTabId": None, "updatedAt": 7}
    assert client.put("/workbench", headers={"userid": "u1"}, json=cfg).status_code == 200
    assert client.get("/workbench", headers={"userid": "u1"}).json()["updatedAt"] == 7


def test_resolve_unknown_404(client):
    r = client.post("/workbench/metrics/ghost/resolve", headers={"userid": "u1"}, json={})
    assert r.status_code == 404

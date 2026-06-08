from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.feedback_api import router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_feedback_blocked_offline():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=True):
        resp = _client().post("/feedback", json={"title": "x"})
    assert resp.status_code == 503


def test_feedback_forwards_online_with_token():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=False), \
         patch("src.api.feedback_api.feedback_service.submit_feedback",
               return_value={"ok": True, "message": "ok", "remote": {"ticket": "B-1"}}) as sf:
        resp = _client().post(
            "/feedback", json={"title": "x"}, headers={"token": "tok"}
        )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    _, kwargs = sf.call_args
    assert kwargs.get("token") == "tok" or sf.call_args[0][1] == "tok"

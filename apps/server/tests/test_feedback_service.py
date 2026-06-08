from unittest.mock import MagicMock, patch

import pytest

from src.service import feedback_service


def test_collect_env_has_core_fields(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    monkeypatch.setenv("OFFLINE_MODE", "0")
    env = feedback_service.collect_env()
    assert env["app_version"] == "9.9.9"
    assert "os" in env and "arch" in env
    assert env["offline"] is False


def test_collect_env_app_version_unknown_when_unset(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert feedback_service.collect_env()["app_version"] == "unknown"


def test_collect_logs_returns_none_when_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(feedback_service, "_LOG_DIR", tmp_path)
    assert feedback_service.collect_logs() is None


def test_collect_logs_truncates_to_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(feedback_service, "_LOG_DIR", tmp_path)
    (tmp_path / "app.log").write_text("\n".join(f"line{i}" for i in range(2000)))
    out = feedback_service.collect_logs(cap_lines=10)
    assert out is not None
    assert out.count("line") <= 30
    assert "line1999" in out


def test_submit_feedback_errors_when_unconfigured(monkeypatch):
    monkeypatch.setattr(feedback_service, "_feedback_url", lambda: None)
    monkeypatch.setattr(feedback_service, "is_offline_mode", lambda: False)
    res = feedback_service.submit_feedback({"title": "x"}, token="t")
    assert res["ok"] is False
    assert "未配置" in res["message"]


def test_submit_feedback_blocks_offline(monkeypatch):
    monkeypatch.setattr(feedback_service, "_feedback_url", lambda: "https://x/y")
    monkeypatch.setattr(feedback_service, "is_offline_mode", lambda: True)
    res = feedback_service.submit_feedback({"title": "x"}, token="t")
    assert res["ok"] is False
    assert "离线" in res["message"]


def test_submit_feedback_posts_with_token(monkeypatch):
    monkeypatch.setattr(feedback_service, "_feedback_url", lambda: "https://x/feedback")
    monkeypatch.setattr(feedback_service, "is_offline_mode", lambda: False)
    fake_resp = MagicMock()
    fake_resp.raise_for_status.return_value = None
    fake_resp.json.return_value = {"ticket": "BUG-1"}
    with patch.object(feedback_service.httpx, "post", return_value=fake_resp) as post:
        res = feedback_service.submit_feedback({"title": "x"}, token="tok")
    assert res["ok"] is True
    assert res["remote"] == {"ticket": "BUG-1"}
    _, kwargs = post.call_args
    assert kwargs["headers"]["token"] == "tok"

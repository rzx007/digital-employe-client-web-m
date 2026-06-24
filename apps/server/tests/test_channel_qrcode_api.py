import pytest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.service.channel.qrcode_auth import QRCodeResult, PollResult


@pytest.fixture()
def client(monkeypatch):
    # 能力门打开：patch deps 模块持有的 get_capabilities 名字
    # （require_capability 闭包用 src.core.deps.get_capabilities，patch runtime_capabilities 模块打不中）
    monkeypatch.setattr(
        "src.core.deps.get_capabilities",
        lambda: type("C", (), {"feishu_platform": True})(),
    )
    from src.api.channel_qrcode_api import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_unknown_channel_404(client):
    r = client.get("/channels/nope/qrcode")
    assert r.status_code == 404


def test_qrcode_ok(client):
    with patch("src.api.channel_qrcode_api.QRCODE_AUTH_HANDLERS", {
        "feishu": type("H", (), {
            "fetch_qrcode": AsyncMock(return_value=QRCodeResult("https://x/scan", "dev_1")),
        })()
    }):
        r = client.get("/channels/feishu/qrcode")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["poll_token"] == "dev_1"
    assert isinstance(data["qrcode_img"], str) and len(data["qrcode_img"]) > 0


def test_status_ok(client):
    with patch("src.api.channel_qrcode_api.QRCODE_AUTH_HANDLERS", {
        "feishu": type("H", (), {
            "poll_status": AsyncMock(return_value=PollResult(
                "success", {"app_id": "cli", "app_secret": "sec", "open_id": "ou"})),
        })()
    }):
        r = client.get("/channels/feishu/qrcode/status", params={"token": "dev_1"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["status"] == "success"
    assert data["credentials"]["app_id"] == "cli"


def test_handler_error_maps_502(client):
    with patch("src.api.channel_qrcode_api.QRCODE_AUTH_HANDLERS", {
        "feishu": type("H", (), {
            "fetch_qrcode": AsyncMock(side_effect=RuntimeError("feishu down")),
        })()
    }):
        r = client.get("/channels/feishu/qrcode")
    assert r.status_code == 502

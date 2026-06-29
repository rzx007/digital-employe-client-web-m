import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.service.channel.cred_test import (
    test_feishu_credentials as run_feishu_cred_test,
)


def _patch_httpx(monkeypatch, payload=None, raise_exc=None):
    import httpx

    class _Resp:
        def json(self):
            return payload

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            if raise_exc is not None:
                raise raise_exc
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)


def test_feishu_credentials_ok(monkeypatch):
    _patch_httpx(monkeypatch, payload={"code": 0, "tenant_access_token": "t-xxx"})
    ok, msg = asyncio.run(run_feishu_cred_test("cli_x", "sec_x"))
    assert ok is True
    assert msg == "连接成功"


def test_feishu_credentials_invalid(monkeypatch):
    _patch_httpx(
        monkeypatch,
        payload={"code": 1000040345, "msg": "app_id or app_secret is invalid"},
    )
    ok, msg = asyncio.run(run_feishu_cred_test("cli_x", "bad"))
    assert ok is False
    assert msg == "app_id or app_secret is invalid"


def test_feishu_credentials_connection_error(monkeypatch):
    _patch_httpx(monkeypatch, raise_exc=RuntimeError("boom"))
    ok, msg = asyncio.run(run_feishu_cred_test("cli_x", "sec_x"))
    assert ok is False
    assert msg.startswith("连接失败：")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(
        "src.core.deps.get_capabilities",
        lambda: type("C", (), {"feishu_platform": True})(),
    )
    from src.api.channel_qrcode_api import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_test_endpoint_ok(client, monkeypatch):
    async def _fake(app_id, app_secret):
        return True, "ok"

    monkeypatch.setattr(
        "src.api.channel_qrcode_api.CHANNEL_CRED_TESTERS", {"feishu": _fake}
    )
    r = client.post(
        "/channels/feishu/test",
        json={"app_id": "cli_x", "app_secret": "sec_x"},
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["ok"] is True
    assert data["message"] == "ok"


def test_test_endpoint_unknown_channel_404(client, monkeypatch):
    monkeypatch.setattr(
        "src.api.channel_qrcode_api.CHANNEL_CRED_TESTERS", {"feishu": None}
    )
    r = client.post(
        "/channels/nope/test",
        json={"app_id": "a", "app_secret": "b"},
    )
    assert r.status_code == 404

import base64
import pytest
from src.service.channel.qrcode_auth import (
    _normalize_feishu_poll, generate_qrcode_image, PollResult,
    QRCODE_AUTH_HANDLERS,
)


def test_poll_success():
    r = _normalize_feishu_poll({
        "client_id": "cli_123", "client_secret": "sec_456",
        "user_info": {"open_id": "ou_789"},
    })
    assert r.status == "success"
    assert r.credentials == {"app_id": "cli_123", "app_secret": "sec_456", "open_id": "ou_789"}


def test_poll_waiting():
    assert _normalize_feishu_poll({"error": "authorization_pending"}).status == "waiting"
    assert _normalize_feishu_poll({"error": "slow_down"}).status == "waiting"
    assert _normalize_feishu_poll({}).status == "waiting"


def test_poll_expired():
    assert _normalize_feishu_poll({"error": "expired_token"}).status == "expired"
    assert _normalize_feishu_poll({"error": "invalid_grant"}).status == "expired"


def test_poll_fail():
    assert _normalize_feishu_poll({"error": "access_denied"}).status == "fail"
    assert _normalize_feishu_poll({"error": "something_else"}).status == "fail"


def test_generate_qrcode_image_is_base64_png():
    img = generate_qrcode_image("https://example.com/scan")
    raw = base64.b64decode(img)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


def test_registry_has_feishu():
    assert "feishu" in QRCODE_AUTH_HANDLERS


def test_fetch_qrcode_orchestration(monkeypatch):
    import httpx, asyncio
    from src.service.channel.qrcode_auth import FeishuQRCodeAuthHandler

    class _Resp:
        def __init__(self, payload): self._p = payload
        def raise_for_status(self): pass
        def json(self): return self._p

    async def _post(url, content=None, headers=None):
        payload = content.decode() if isinstance(content, bytes) else content
        if "action=init" in payload:
            return _Resp({"supported_auth_methods": ["client_secret"]})
        return _Resp({"device_code": "dev_X",
                      "verification_uri_complete": "https://applink.feishu.cn/x?k=1"})

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, content=None, headers=None):
            return await _post(url, content=content, headers=headers)

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    result = asyncio.run(FeishuQRCodeAuthHandler().fetch_qrcode())
    assert result.poll_token == "dev_X"
    assert "source=DigitalEmployee" in result.scan_url
    assert "&source=" in result.scan_url  # verification_uri 已含 ?


def test_fetch_qrcode_unsupported_method(monkeypatch):
    import httpx, asyncio
    from src.service.channel.qrcode_auth import FeishuQRCodeAuthHandler

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return {"supported_auth_methods": []}

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    with pytest.raises(RuntimeError):
        asyncio.run(FeishuQRCodeAuthHandler().fetch_qrcode())

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


def test_poll_status_pending_400_is_waiting(monkeypatch):
    """回归：设备流未授权时飞书返 HTTP 400 + JSON {"error":"authorization_pending"}，
    这是 RFC8628 正常的'仍在等待'，必须归一为 waiting、绝不能因 400 抛错。"""
    import httpx, asyncio
    from src.service.channel.qrcode_auth import FeishuQRCodeAuthHandler

    class _Resp:
        # 即便 raise_for_status 会因 400 抛，只要 body 是 JSON 就不该走到它
        def raise_for_status(self): raise RuntimeError("400 Bad Request")
        def json(self): return {"error": "authorization_pending"}

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    r = asyncio.run(FeishuQRCodeAuthHandler().poll_status("dev_x"))
    assert r.status == "waiting"


def test_poll_status_raises_on_non_json(monkeypatch):
    """真·错误页(非 JSON body)：json() 抛 → raise_for_status 抛清晰 HTTP 错误。"""
    import httpx, asyncio
    from src.service.channel.qrcode_auth import FeishuQRCodeAuthHandler

    class _Resp:
        def raise_for_status(self): raise RuntimeError("500 from feishu")
        def json(self): raise ValueError("not json")

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    with pytest.raises(Exception):
        asyncio.run(FeishuQRCodeAuthHandler().poll_status("dev_x"))

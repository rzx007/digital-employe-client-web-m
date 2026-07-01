from license_issuer_server import feishu_token as ft


def test_get_token_caches_and_refreshes(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, body=None, headers=None):
        calls["n"] += 1
        return {"code": 0, "tenant_access_token": f"tok{calls['n']}", "expire": 7200}

    monkeypatch.setattr(ft, "_http_json", lambda method, url, body=None, headers=None: fake_post(url, body))
    t = ft.FeishuToken("app", "secret")
    assert t.get() == "tok1"
    assert t.get() == "tok1"
    assert calls["n"] == 1
    t._expire_at = 0
    assert t.get() == "tok2"
    assert calls["n"] == 2


def test_get_token_raises_on_error(monkeypatch):
    monkeypatch.setattr(ft, "_http_json",
                        lambda *a, **k: {"code": 99991663, "msg": "bad app_secret"})
    t = ft.FeishuToken("app", "secret")
    import pytest
    with pytest.raises(ft.FeishuError):
        t.get()

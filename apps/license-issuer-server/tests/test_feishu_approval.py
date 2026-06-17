import json
from license_issuer_server import feishu_approval as fa


class FakeToken:
    def get(self, now=None):
        return "tok-fake"


def _client(monkeypatch, routes):
    def fake_http(method, url, body=None, headers=None):
        for (m, frag), resp in routes.items():
            if m == method and frag in url:
                return resp
        raise AssertionError(f"unexpected call {method} {url}")
    monkeypatch.setattr(fa, "_http_json", fake_http)
    return fa.FeishuApproval(FakeToken(), approval_code="APPCODE",
                             device_field="wdev", expires_field="wexp",
                             comment_prefix="【激活授权码】")


def test_list_approved_instances(monkeypatch):
    c = _client(monkeypatch, {
        ("GET", "/instances?"): {"code": 0, "data": {
            "instance_code_list": ["I1", "I2"], "has_more": False, "page_token": ""}},
    })
    assert c.list_instances(start_ms=1, end_ms=2) == ["I1", "I2"]


def test_get_instance_parses_form(monkeypatch):
    form = json.dumps([
        {"id": "wdev", "name": "设备码", "type": "input", "value": "TEST-DEVICE-0001"},
        {"id": "wexp", "name": "截至日期", "type": "date", "value": "2027-06-01T00:00:00+08:00"},
    ])
    c = _client(monkeypatch, {
        ("GET", "/instances/I1"): {"code": 0, "data": {
            "status": "APPROVED", "user_id": "u1", "form": form}},
    })
    inst = c.get_instance("I1")
    assert inst.status == "APPROVED"
    assert inst.user_id == "u1"
    assert inst.device_code == "TEST-DEVICE-0001"
    assert inst.expires == "2027-06-01"


def test_get_instance_missing_optional_fields(monkeypatch):
    form = json.dumps([
        {"id": "wdev", "name": "设备码", "type": "input", "value": "DEV-X"},
    ])
    c = _client(monkeypatch, {
        ("GET", "/instances/I9"): {"code": 0, "data": {
            "status": "APPROVED", "user_id": "u1", "form": form}},
    })
    inst = c.get_instance("I9")
    assert inst.device_code == "DEV-X"
    assert inst.expires is None


def test_license_already_commented(monkeypatch):
    c = _client(monkeypatch, {
        ("GET", "/comments"): {"code": 0, "data": {"comments": [
            {"comment": json.dumps({"text": "【激活授权码】abc.def", "files": None})}]}},
    })
    assert c.has_license_comment("I1", "u1") is True


def test_license_not_commented(monkeypatch):
    c = _client(monkeypatch, {
        ("GET", "/comments"): {"code": 0, "data": {"comments": [
            {"comment": json.dumps({"text": "随便一条人写的评论", "files": None})}]}},
    })
    assert c.has_license_comment("I1", "u1") is False


def test_write_license_comment(monkeypatch):
    captured = {}
    def fake_http(method, url, body=None, headers=None):
        captured["method"] = method
        captured["url"] = url
        captured["body"] = body
        return {"code": 0, "data": {"comment_id": "cid1"}}
    monkeypatch.setattr(fa, "_http_json", fake_http)
    c = fa.FeishuApproval(FakeToken(), "APPCODE", "wdev", "wexp", "【激活授权码】")
    c.write_license_comment("I1", "u1", "abc.def")
    assert captured["method"] == "POST"
    assert "/instances/I1/comments" in captured["url"]
    inner = json.loads(captured["body"]["content"])
    assert inner["text"] == "【激活授权码】abc.def"

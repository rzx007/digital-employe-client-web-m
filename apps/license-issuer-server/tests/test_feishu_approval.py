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
            {"content": json.dumps({"text": "【激活授权码】abc.def", "files": None})}]}},
    })
    assert c.has_license_comment("I1", "u1") is True


def test_license_not_commented(monkeypatch):
    c = _client(monkeypatch, {
        ("GET", "/comments"): {"code": 0, "data": {"comments": [
            {"content": json.dumps({"text": "随便一条人写的评论", "files": None})}]}},
    })
    assert c.has_license_comment("I1", "u1") is False


def test_deleted_license_comment_ignored(monkeypatch):
    # 软删的激活码评论（is_delete=1）不算"已出码"，应可重新出码
    c = _client(monkeypatch, {
        ("GET", "/comments"): {"code": 0, "data": {"comments": [
            {"is_delete": 1,
             "content": json.dumps({"text": "【激活授权码】old.deleted", "files": None})}]}},
    })
    assert c.has_license_comment("I1", "u1") is False


def test_write_license_comment_with_attachment(monkeypatch):
    captured = {}
    def fake_http(method, url, body=None, headers=None):
        captured["body"] = body
        return {"code": 0, "data": {"comment_id": "cid1"}}
    monkeypatch.setattr(fa, "_http_json", fake_http)
    c = fa.FeishuApproval(FakeToken(), "APPCODE", "wdev", "wexp", "【激活授权码】")
    # mock 文件上传，返回 (url, size)，避免真连飞书
    monkeypatch.setattr(c, "_upload_license_file", lambda lic: ("https://feishucdn/x.code?sig=1", 8))
    c.write_license_comment("I1", "u1", "abc.def")
    inner = json.loads(captured["body"]["content"])
    # 文本含前缀+激活码+使用指引（文件名与放置目录）
    assert inner["text"].startswith("【激活授权码】abc.def")
    assert fa.LICENSE_FILENAME in inner["text"]
    assert fa.LICENSE_DIR in inner["text"]
    # 带附件，url 为上传返回的真实可下载地址（不能空）
    assert inner["files"][0]["url"] == "https://feishucdn/x.code?sig=1"
    assert inner["files"][0]["file_size"] == 8
    assert inner["files"][0]["title"] == fa.LICENSE_FILENAME


def test_write_license_comment_falls_back_to_text_when_upload_fails(monkeypatch):
    captured = {}
    def fake_http(method, url, body=None, headers=None):
        captured["body"] = body
        return {"code": 0, "data": {"comment_id": "cid1"}}
    monkeypatch.setattr(fa, "_http_json", fake_http)
    c = fa.FeishuApproval(FakeToken(), "APPCODE", "wdev", "wexp", "【激活授权码】")
    def boom(lic):
        raise fa.FeishuError("upload down")
    monkeypatch.setattr(c, "_upload_license_file", boom)
    c.write_license_comment("I1", "u1", "abc.def")
    inner = json.loads(captured["body"]["content"])
    # 降级：仍含激活码+指引，但无 files
    assert inner["text"].startswith("【激活授权码】abc.def")
    assert "files" not in inner

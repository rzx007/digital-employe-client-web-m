# 飞书审批轮询器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在签发服务里加后台轮询器：定时拉飞书「数字员工激活申请」已通过实例 → 取设备码+截至日期 → 调 IssueService 出激活码 → 以评论回写到该审批单（评论=防重标记）。

**Architecture:** 纯出站轮询（无公网入口）。新增 `feishu_token` / `feishu_approval` / `poller` 三个聚焦模块到 `apps/license-issuer-server`。回写用评论（已通过的单改不了表单字段，真机验证过）。防重 = 该实例是否已有以固定前缀开头的激活码评论。

**Tech Stack:** Python（标准库 urllib，不引第三方 HTTP 库，与现有镜像一致）、pytest（mock 飞书响应）、复用已合入的 `IssueService`。

---

## 已验证的飞书接口事实（真机跑通，照此实现，勿再猜）

凭据/配置（全部走 env，**勿硬编码**）：
- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（真值在 216 部署时注入；测试用 mock）
- `FEISHU_APPROVAL_CODE` = 审批定义 code（如 `BEBCCB45-...`）
- `FEISHU_DEVICE_CODE_FIELD` = 设备码控件 id（如 `widget17816808748370001`）
- `FEISHU_EXPIRES_FIELD` = 截至日期控件 id（如 `widget17816814056340001`）
- `FEISHU_LICENSE_COMMENT_PREFIX` = 评论前缀，默认 `【激活授权码】`
- `POLL_INTERVAL` 默认 60（秒）

接口（base `https://open.feishu.cn`）：

1. **换 token**：`POST /open-apis/auth/v3/tenant_access_token/internal`
   body `{"app_id":...,"app_secret":...}` → `{"code":0,"tenant_access_token":"...","expire":7200}`。

2. **列实例**：`GET /open-apis/approval/v4/instances?approval_code=<CODE>&start_time=<ms>&end_time=<ms>&page_size=50`
   - start/end 是**毫秒**时间戳字符串；窗口不宜过大。
   - 返回 `{"code":0,"data":{"instance_code_list":["25FBC935-..."],"has_more":false,"page_token":""}}`。
   - 注意分页：`has_more`/`page_token`。

3. **取实例详情**：`GET /open-apis/approval/v4/instances/{instance_code}`
   - 返回 `data.status`（`APPROVED` / `PENDING` / `REJECTED` ...）、`data.user_id`（发起人）、`data.form`（**JSON 字符串**）。
   - `form` 解析后是 list，每项 `{"id":..., "name":..., "type":..., "value":...}`。
     - 设备码：`type=input`，`value` 即字符串（如 `TEST-DEVICE-0001`）。
     - 截至日期：`type=date`，`value` 形如 `2026-06-17T00:00:00+08:00` → **取前 10 位**得 `YYYY-MM-DD`。
     - **空字段不会出现在 form 里**（留空的控件直接缺省，不报错）。

4. **加评论**：`POST /open-apis/approval/v4/instances/{instance_code}/comments?user_id_type=user_id&user_id=<发起人user_id>`
   body `{"content": "{\"text\":\"【激活授权码】<license_code>\"}"}`（content 是**字符串**，内层又是 JSON 串）
   → `{"code":0,"data":{"comment_id":"..."}}`。

5. **读评论**：`GET /open-apis/approval/v4/instances/{instance_code}/comments?user_id_type=user_id&user_id=<user_id>`
   → `data.comments` list，每项 `comment` 是 JSON 串 `{"text":"...","files":null}`。

`IssueService`（已合入，复用）：
`IssueService().issue(device_code: str, expires: str, private_key_path: Path) -> IssueResult`
`IssueResult{device_code_display, expires_at: datetime, license_code: str}`。
`expires` 接受 `YYYY-MM-DD` / `+90d`；本轮询器用截至日期字段值，空则用 `ISSUER_DEFAULT_EXPIRES`。

---

## File Structure

| 文件 | 责任 |
|------|------|
| `apps/license-issuer-server/src/license_issuer_server/feishu_token.py` | 换/缓存 tenant_access_token |
| `apps/license-issuer-server/src/license_issuer_server/feishu_approval.py` | 飞书审批客户端：列实例/取表单/读评论/加评论 + 表单值解析 |
| `apps/license-issuer-server/src/license_issuer_server/poller.py` | 编排：poll_once / run_forever |
| `apps/license-issuer-server/src/license_issuer_server/poller_config.py` | 轮询相关 env 读取（与现有 config.py 分开，职责清晰） |
| `apps/license-issuer-server/src/license_issuer_server/__main__.py` | 扩展：`python -m license_issuer_server poll` 启动轮询 |
| `apps/license-issuer-server/tests/test_feishu_token.py` | token mock 测试 |
| `apps/license-issuer-server/tests/test_feishu_approval.py` | 审批客户端 mock 测试（用真机样例 fixture） |
| `apps/license-issuer-server/tests/test_poller.py` | poll_once mock 测试 |

测试用 `monkeypatch` 替换一个统一的 HTTP 调用函数（见 Task 1 的 `_http_json`），不真连飞书。

---

## Task 1: feishu_token —— token 获取与缓存

**Files:**
- Create: `apps/license-issuer-server/src/license_issuer_server/feishu_token.py`
- Test: `apps/license-issuer-server/tests/test_feishu_token.py`

- [ ] **Step 1: 写失败测试**

Create `tests/test_feishu_token.py`:

```python
from license_issuer_server import feishu_token as ft


def test_get_token_caches_and_refreshes(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, body=None, headers=None):
        calls["n"] += 1
        return {"code": 0, "tenant_access_token": f"tok{calls['n']}", "expire": 7200}

    monkeypatch.setattr(ft, "_http_json", lambda method, url, body=None, headers=None: fake_post(url, body))
    t = ft.FeishuToken("app", "secret")
    # 第一次取 → 调一次
    assert t.get() == "tok1"
    # 立刻再取 → 命中缓存，不再调
    assert t.get() == "tok1"
    assert calls["n"] == 1
    # 强制过期 → 重新取
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/license-issuer-server && uv run pytest tests/test_feishu_token.py -v`
Expected: FAIL（模块/类不存在）。

- [ ] **Step 3: 实现 feishu_token.py**

```python
"""飞书 tenant_access_token 获取与缓存。标准库 urllib，无第三方依赖。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

FEISHU_BASE = "https://open.feishu.cn"


class FeishuError(RuntimeError):
    """飞书接口返回非 0 code 或网络错误。"""


def _http_json(method: str, url: str, body: dict | None = None,
               headers: dict | None = None) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    h = {"Content-Type": "application/json; charset=utf-8"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except Exception:
            raise FeishuError(f"HTTP {exc.code}: {raw[:200]}") from exc
    except Exception as exc:  # noqa: BLE001
        raise FeishuError(str(exc)) from exc


class FeishuToken:
    def __init__(self, app_id: str, app_secret: str) -> None:
        self._app_id = app_id
        self._app_secret = app_secret
        self._token: str | None = None
        self._expire_at: float = 0.0

    def get(self, now: float | None = None) -> str:
        cur = now if now is not None else time.time()
        if self._token and cur < self._expire_at:
            return self._token
        r = _http_json(
            "POST",
            f"{FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal",
            {"app_id": self._app_id, "app_secret": self._app_secret},
        )
        if r.get("code") != 0:
            raise FeishuError(f"获取 token 失败: {r.get('code')} {r.get('msg')}")
        self._token = r["tenant_access_token"]
        # 提前 5 分钟过期，避免边界
        self._expire_at = cur + int(r.get("expire", 7200)) - 300
        return self._token
```

注：测试 monkeypatch 的是模块级 `_http_json`，故 `get()` 内必须调用模块级 `_http_json`（上面即是）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/license-issuer-server && uv run pytest tests/test_feishu_token.py -v`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add apps/license-issuer-server/src/license_issuer_server/feishu_token.py apps/license-issuer-server/tests/test_feishu_token.py
git commit -m "feat(issuer): 飞书 tenant_access_token 获取+缓存"
```

---

## Task 2: feishu_approval —— 审批客户端

**Files:**
- Create: `apps/license-issuer-server/src/license_issuer_server/feishu_approval.py`
- Test: `apps/license-issuer-server/tests/test_feishu_approval.py`

- [ ] **Step 1: 写失败测试（用真机样例 fixture）**

Create `tests/test_feishu_approval.py`:

```python
import json
from license_issuer_server import feishu_approval as fa


class FakeToken:
    def get(self, now=None):
        return "tok-fake"


def _client(monkeypatch, routes):
    """routes: dict[(method, url_contains)] -> response dict"""
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
    assert inst.expires == "2027-06-01"  # date 取前 10 位


def test_get_instance_missing_optional_fields(monkeypatch):
    # 截至日期留空 → form 里无该 widget；expires 返回 None
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
    # content 是字符串，内层 JSON 含前缀+授权码
    inner = json.loads(captured["body"]["content"])
    assert inner["text"] == "【激活授权码】abc.def"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/license-issuer-server && uv run pytest tests/test_feishu_approval.py -v`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 feishu_approval.py**

```python
"""飞书审批客户端：列实例 / 取表单 / 读写评论。接口格式见 plan「已验证事实」。"""

from __future__ import annotations

import json
import urllib.parse
from dataclasses import dataclass

from license_issuer_server.feishu_token import FEISHU_BASE, FeishuError, _http_json


@dataclass
class Instance:
    instance_code: str
    status: str
    user_id: str | None
    device_code: str | None
    expires: str | None


class FeishuApproval:
    def __init__(self, token, approval_code: str, device_field: str,
                 expires_field: str, comment_prefix: str) -> None:
        self._token = token
        self._approval_code = approval_code
        self._device_field = device_field
        self._expires_field = expires_field
        self._prefix = comment_prefix

    def _auth(self) -> dict:
        return {"Authorization": f"Bearer {self._token.get()}"}

    def list_instances(self, start_ms: int, end_ms: int) -> list[str]:
        out: list[str] = []
        page_token = ""
        while True:
            params = {
                "approval_code": self._approval_code,
                "start_time": str(start_ms),
                "end_time": str(end_ms),
                "page_size": "50",
            }
            if page_token:
                params["page_token"] = page_token
            url = f"{FEISHU_BASE}/open-apis/approval/v4/instances?{urllib.parse.urlencode(params)}"
            r = _http_json("GET", url, headers=self._auth())
            if r.get("code") != 0:
                raise FeishuError(f"列实例失败: {r.get('code')} {r.get('msg')}")
            data = r.get("data", {})
            out.extend(data.get("instance_code_list", []))
            if data.get("has_more") and data.get("page_token"):
                page_token = data["page_token"]
                continue
            return out

    def get_instance(self, instance_code: str) -> Instance:
        url = f"{FEISHU_BASE}/open-apis/approval/v4/instances/{instance_code}"
        r = _http_json("GET", url, headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"取实例失败: {r.get('code')} {r.get('msg')}")
        data = r.get("data", {})
        form_raw = data.get("form") or "[]"
        widgets = json.loads(form_raw) if isinstance(form_raw, str) else form_raw
        by_id = {w.get("id"): w.get("value") for w in widgets}
        dev = by_id.get(self._device_field)
        exp_raw = by_id.get(self._expires_field)
        expires = exp_raw[:10] if isinstance(exp_raw, str) and len(exp_raw) >= 10 else None
        return Instance(
            instance_code=instance_code,
            status=data.get("status", ""),
            user_id=data.get("user_id"),
            device_code=dev if isinstance(dev, str) and dev else None,
            expires=expires,
        )

    def _comments_url(self, instance_code: str, user_id: str) -> str:
        q = urllib.parse.urlencode({"user_id_type": "user_id", "user_id": user_id})
        return f"{FEISHU_BASE}/open-apis/approval/v4/instances/{instance_code}/comments?{q}"

    def has_license_comment(self, instance_code: str, user_id: str) -> bool:
        r = _http_json("GET", self._comments_url(instance_code, user_id), headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"读评论失败: {r.get('code')} {r.get('msg')}")
        for c in r.get("data", {}).get("comments", []):
            raw = c.get("comment")
            text = ""
            if isinstance(raw, str):
                try:
                    text = json.loads(raw).get("text", "")
                except Exception:
                    text = raw
            if text.startswith(self._prefix):
                return True
        return False

    def write_license_comment(self, instance_code: str, user_id: str, license_code: str) -> str:
        content = json.dumps({"text": f"{self._prefix}{license_code}"}, ensure_ascii=False)
        r = _http_json("POST", self._comments_url(instance_code, user_id),
                       body={"content": content}, headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"写评论失败: {r.get('code')} {r.get('msg')}")
        return r.get("data", {}).get("comment_id", "")
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/license-issuer-server && uv run pytest tests/test_feishu_approval.py -v`
Expected: PASS（7 passed）。

- [ ] **Step 5: Commit**

```bash
git add apps/license-issuer-server/src/license_issuer_server/feishu_approval.py apps/license-issuer-server/tests/test_feishu_approval.py
git commit -m "feat(issuer): 飞书审批客户端（列实例/取表单/读写评论）"
```

---

## Task 3: poller_config —— 轮询配置

**Files:**
- Create: `apps/license-issuer-server/src/license_issuer_server/poller_config.py`
- Test: 并入 `tests/test_poller.py`（Task 4）

- [ ] **Step 1: 实现 poller_config.py**（配置读取无分支逻辑，直接实现 + Task 4 一起测）

```python
"""轮询器配置：全部来自环境变量。"""

from __future__ import annotations

import os


def get_poll_config() -> dict:
    return {
        "app_id": os.getenv("FEISHU_APP_ID", "").strip(),
        "app_secret": os.getenv("FEISHU_APP_SECRET", "").strip(),
        "approval_code": os.getenv("FEISHU_APPROVAL_CODE", "").strip(),
        "device_field": os.getenv("FEISHU_DEVICE_CODE_FIELD", "").strip(),
        "expires_field": os.getenv("FEISHU_EXPIRES_FIELD", "").strip(),
        "comment_prefix": os.getenv("FEISHU_LICENSE_COMMENT_PREFIX", "【激活授权码】"),
        "poll_interval": int(os.getenv("POLL_INTERVAL", "60")),
        "default_expires": os.getenv("ISSUER_DEFAULT_EXPIRES", "+90d").strip() or "+90d",
    }


def validate_config(cfg: dict) -> list[str]:
    """返回缺失的必填项列表（空=齐全）。"""
    required = ["app_id", "app_secret", "approval_code", "device_field"]
    return [k for k in required if not cfg.get(k)]
```

- [ ] **Step 2: Commit**（测试随 Task 4）

```bash
git add apps/license-issuer-server/src/license_issuer_server/poller_config.py
git commit -m "feat(issuer): 轮询器配置读取"
```

---

## Task 4: poller —— 编排循环

**Files:**
- Create: `apps/license-issuer-server/src/license_issuer_server/poller.py`
- Test: `apps/license-issuer-server/tests/test_poller.py`

- [ ] **Step 1: 写失败测试**

Create `tests/test_poller.py`:

```python
from types import SimpleNamespace
from license_issuer_server import poller as p
from license_issuer_server import poller_config as pc


def test_validate_config_reports_missing():
    assert "app_id" in pc.validate_config({})
    assert pc.validate_config({
        "app_id": "a", "app_secret": "b", "approval_code": "c", "device_field": "d"}) == []


class FakeApproval:
    def __init__(self, instances, forms, commented):
        self._instances = instances        # list[str]
        self._forms = forms                # dict[code] -> Instance-like
        self._commented = set(commented)   # codes already commented
        self.written = []                  # (code, user, license)

    def list_instances(self, start_ms, end_ms):
        return list(self._instances)

    def get_instance(self, code):
        return self._forms[code]

    def has_license_comment(self, code, user_id):
        return code in self._commented

    def write_license_comment(self, code, user_id, license_code):
        self.written.append((code, user_id, license_code))
        self._commented.add(code)


def _inst(code, status="APPROVED", user="u1", dev="DEV-1", expires="2027-06-01"):
    return SimpleNamespace(instance_code=code, status=status, user_id=user,
                           device_code=dev, expires=expires)


class FakeIssuer:
    def __init__(self):
        self.calls = []

    def issue(self, device_code, expires, private_key_path):
        self.calls.append((device_code, expires))
        return SimpleNamespace(license_code=f"LIC[{device_code}|{expires}]",
                               device_code_display=device_code, expires_at=None)


def _run_once(approval, issuer, default_expires="+90d"):
    return p.poll_once(approval, issuer, private_key_path="/k/private.pem",
                       default_expires=default_expires, window_ms=(1, 2))


def test_approved_uncommented_issues_and_writes():
    ap = FakeApproval(["I1"], {"I1": _inst("I1")}, commented=[])
    iss = FakeIssuer()
    n = _run_once(ap, iss)
    assert n == 1
    assert iss.calls == [("DEV-1", "2027-06-01")]
    assert ap.written == [("I1", "u1", "LIC[DEV-1|2027-06-01]")]


def test_already_commented_skipped():
    ap = FakeApproval(["I1"], {"I1": _inst("I1")}, commented=["I1"])
    iss = FakeIssuer()
    assert _run_once(ap, iss) == 0
    assert iss.calls == []
    assert ap.written == []


def test_non_approved_skipped():
    ap = FakeApproval(["I1"], {"I1": _inst("I1", status="PENDING")}, commented=[])
    iss = FakeIssuer()
    assert _run_once(ap, iss) == 0
    assert iss.calls == []


def test_missing_device_skipped():
    ap = FakeApproval(["I1"], {"I1": _inst("I1", dev=None)}, commented=[])
    iss = FakeIssuer()
    assert _run_once(ap, iss) == 0
    assert iss.calls == []


def test_missing_expires_falls_back_to_default():
    ap = FakeApproval(["I1"], {"I1": _inst("I1", expires=None)}, commented=[])
    iss = FakeIssuer()
    assert _run_once(ap, iss, default_expires="+90d") == 1
    assert iss.calls == [("DEV-1", "+90d")]


def test_one_failure_does_not_block_others():
    ap = FakeApproval(["I1", "I2"], {"I1": _inst("I1"), "I2": _inst("I2", dev="DEV-2")},
                      commented=[])

    iss = FakeIssuer()
    orig = iss.issue
    def flaky(device_code, expires, private_key_path):
        if device_code == "DEV-1":
            raise RuntimeError("boom")
        return orig(device_code, expires, private_key_path)
    iss.issue = flaky
    n = _run_once(ap, iss)
    # I1 失败跳过，I2 仍出码
    assert n == 1
    assert ap.written == [("I2", "u1", "LIC[DEV-2|2027-06-01]")]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/license-issuer-server && uv run pytest tests/test_poller.py -v`
Expected: FAIL（poller 模块/poll_once 不存在）。

- [ ] **Step 3: 实现 poller.py**

```python
"""轮询编排：拉已通过实例 → 出码 → 评论回写。无公网入口，纯出站。"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


def poll_once(approval, issuer, private_key_path, default_expires, window_ms) -> int:
    """处理一轮。返回本轮成功出码数。单条失败不阻塞其它。"""
    start_ms, end_ms = window_ms
    issued = 0
    try:
        codes = approval.list_instances(start_ms, end_ms)
    except Exception as exc:  # noqa: BLE001
        logger.warning("列实例失败，跳过本轮: %s", exc)
        return 0

    for code in codes:
        try:
            inst = approval.get_instance(code)
            if inst.status != "APPROVED":
                continue
            if not inst.device_code:
                logger.info("实例 %s 无设备码，跳过", code)
                continue
            if approval.has_license_comment(code, inst.user_id):
                continue  # 已出码（评论存在）
            expires = inst.expires or default_expires
            result = issuer.issue(inst.device_code, expires, private_key_path)
            approval.write_license_comment(code, inst.user_id, result.license_code)
            issued += 1
            logger.info("实例 %s 已出码并回写评论", code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("实例 %s 处理失败，跳过: %s", code, exc)
            continue
    return issued


def _now_ms() -> int:
    return int(time.time() * 1000)


def run_forever(approval, issuer, private_key_path, default_expires,
                interval: int, lookback_ms: int = 7 * 24 * 3600 * 1000) -> None:
    """常驻轮询。窗口 = [now-lookback, now]。异常不崩，sleep 后续跑。"""
    logger.info("轮询器启动，间隔 %ss", interval)
    while True:
        try:
            now = _now_ms()
            n = poll_once(approval, issuer, private_key_path, default_expires,
                          (now - lookback_ms, now))
            if n:
                logger.info("本轮出码 %d 个", n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("轮询循环异常（已捕获）: %s", exc)
        time.sleep(interval)
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/license-issuer-server && uv run pytest tests/test_poller.py -v`
Expected: PASS（8 passed：1 config + 7 poller）。

- [ ] **Step 5: Commit**

```bash
git add apps/license-issuer-server/src/license_issuer_server/poller.py apps/license-issuer-server/tests/test_poller.py
git commit -m "feat(issuer): 轮询编排 poll_once/run_forever（防重/跳过/容错）"
```

---

## Task 5: __main__ 加 poll 子命令 + 装配

**Files:**
- Modify: `apps/license-issuer-server/src/license_issuer_server/__main__.py`

- [ ] **Step 1: 改 __main__.py**

把现有内容替换为（保留无参起 HTTP 的行为，新增 `poll`）：

```python
"""启动入口：
  python -m license_issuer_server         # 起 HTTP 签发服务（/license/issue）
  python -m license_issuer_server poll     # 起飞书审批轮询器
"""

from __future__ import annotations

import logging
import os
import sys


def _run_http() -> None:
    import uvicorn
    host = os.getenv("ISSUER_HOST", "0.0.0.0")
    port = int(os.getenv("ISSUER_PORT", "8900"))
    uvicorn.run("license_issuer_server.app:app", host=host, port=port)


def _run_poll() -> None:
    from license_issuer_server.poller_config import get_poll_config, validate_config
    from license_issuer_server.feishu_token import FeishuToken
    from license_issuer_server.feishu_approval import FeishuApproval
    from license_issuer_server.poller import run_forever
    from license_issuer_server.config import get_private_key_path
    from license_issuer.service import IssueService

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = get_poll_config()
    missing = validate_config(cfg)
    if missing:
        sys.stderr.write(f"轮询器缺少必填配置: {', '.join(missing)}\n")
        sys.exit(2)

    priv = get_private_key_path()
    if not priv.exists():
        sys.stderr.write(f"签发私钥不存在: {priv}\n")
        sys.exit(2)

    token = FeishuToken(cfg["app_id"], cfg["app_secret"])
    approval = FeishuApproval(token, cfg["approval_code"], cfg["device_field"],
                              cfg["expires_field"], cfg["comment_prefix"])
    run_forever(approval, IssueService(), priv, cfg["default_expires"],
                interval=cfg["poll_interval"])


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "poll":
        _run_poll()
    else:
        _run_http()


if __name__ == "__main__":
    main()
```

> 注：`get_private_key_path` 来自现有 `config.py`（已确认存在，解析 `DE_LICENSE_PRIVATE_KEY`）。
> `IssueService().issue(device, expires, priv)` 签名与 poller 调用一致。

- [ ] **Step 2: 冒烟测试（缺配置应退出码 2）**

Run:
```bash
cd apps/license-issuer-server && uv run python -m license_issuer_server poll
```
Expected: 输出 `轮询器缺少必填配置: app_id, app_secret, approval_code, device_field` 并退出码 2（未设 env 时）。

- [ ] **Step 3: 全量测试**

Run: `cd apps/license-issuer-server && uv run pytest -v`
Expected: 全部 PASS（含原有 7 个 + 新增 token/approval/poller 测试）。

- [ ] **Step 4: Commit**

```bash
git add apps/license-issuer-server/src/license_issuer_server/__main__.py
git commit -m "feat(issuer): __main__ 加 poll 子命令，装配轮询器"
```

---

## Task 6: 镜像重建 + 216 真机起轮询 + 端到端验证

**Files:**
- Modify: 无（用已有 Dockerfile；镜像含新模块）
- 216 部署，验证用真实测试审批单

> 凭据/审批配置真值在 `docs/secrets/216-issuer-credentials.md`（不进 git）。
> 执行者从该文件取 `FEISHU_*` 与 `approval_code`/字段 id；SSH 用 `DE220_PWD` 同法但目标是 216
> （216 同密码，用 `_ssh.py` 改 host 或直接 paramiko）。

- [ ] **Step 1: 重打包源码传 216 重建镜像**

本机：
```bash
tar --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' --exclude='*.egg-info' \
  -czf issuer-src.tar.gz packages/activation-core apps/license-issuer apps/license-issuer-server
```
传到 216 `~/issuer-build/` 解包（SFTP 用家目录相对路径），然后：
```bash
cd ~/issuer-build && docker build -f apps/license-issuer-server/Dockerfile -t de-issuer-server .
```
Expected: build 成功，`docker images de-issuer-server` 有新镜像。删本机 `issuer-src.tar.gz`。

- [ ] **Step 2: 起轮询容器（与 HTTP 容器分开，共享同一私钥挂载）**

在 216：
```bash
docker rm -f de-issuer-poller 2>/dev/null
docker run -d --name de-issuer-poller --restart always \
  -e FEISHU_APP_ID=cli_a9d1e24afb38dcc4 \
  -e FEISHU_APP_SECRET=<见机密文件> \
  -e FEISHU_APPROVAL_CODE=BEBCCB45-BFA3-4A5F-8EF4-91BDAC5F0C8D \
  -e FEISHU_DEVICE_CODE_FIELD=widget17816808748370001 \
  -e FEISHU_EXPIRES_FIELD=widget17816814056340001 \
  -e DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem \
  -e POLL_INTERVAL=30 \
  -v /home/boban/issuer-keys:/keys:ro \
  de-issuer-server poll
```
Expected: `docker logs de-issuer-poller` 显示「轮询器启动，间隔 30s」。

- [ ] **Step 3: 端到端验证（真实测试审批单）**

1. 在飞书发起一条新「数字员工激活申请」：设备码 `3E5677F8E9179E207A30`（220 真机设备码）、
   截至日期选未来（如 2027-06-01），通过。
2. 等 ≤30s，看轮询日志：`docker logs --tail 20 de-issuer-poller` 应出现「实例 ... 已出码并回写评论」。
3. 在飞书该审批单看到评论 `【激活授权码】<一长串>`。
4. 复制该授权码，用 220 客户端公钥验签确认有效：
   ```bash
   docker exec de-issuer de-license verify --license '<授权码>' \
     --device 3E5677F8E9179E207A30 --public-key /keys/public_key.pem
   ```
   Expected: `授权码有效`。
5. 防重验证：等下一轮（30s）后再看日志，该实例**不应**再次出码（评论已存在）。

- [ ] **Step 4: 文档收尾**

更新 `docs/license-issuer-server-deploy.md`：加「轮询容器」运行命令与排错（看 `de-issuer-poller` 日志）。
更新机密文件待办：轮询器已上线。

```bash
git add docs/license-issuer-server-deploy.md
git commit -m "docs(issuer): 轮询容器部署说明（216 已上线，端到端验证）"
git push
```

---

## Self-Review

**Spec 覆盖：**
- token 获取缓存（spec §4 feishu_token）→ Task 1 ✓
- 列实例/取表单/取设备码/取到期日（spec §4 feishu_approval）→ Task 2 ✓
- 回写=评论 + 防重=评论前缀（spec §3 真机修正 + §5）→ Task 2（has/write_license_comment）+ Task 4（跳过已评论）✓
- poll_once/run_forever、跳过非 APPROVED/无设备码、单条失败不阻塞、到期回退默认（spec §4/§6）→ Task 4 ✓
- 配置 env（spec §4 config）→ Task 3 ✓
- poll 子命令独立进程（spec §4 __main__、§9 部署）→ Task 5 ✓
- 真机端到端 + 防重（spec §8 测试）→ Task 6 ✓
- 安全：私钥只挂载、app_secret 走 env（spec §7）→ Task 6 env 注入，不入镜像/代码 ✓

**占位符扫描：** 无 TBD；每步含完整代码与预期输出。✓

**命名一致性：** `FeishuToken.get` / `FeishuApproval.{list_instances,get_instance,has_license_comment,write_license_comment}` / `Instance.{status,user_id,device_code,expires}` / `poll_once(approval,issuer,private_key_path,default_expires,window_ms)` / `run_forever(...)` —— 跨 Task（含测试）引用一致。✓

**执行者注意：**
- 飞书 app_secret、私钥等真值在 `docs/secrets/216-issuer-credentials.md`，**勿写进代码/提交**。
- Task 6 在 216（AMD），SSH 同 `_ssh.py` 模式但 host=10.172.246.216。
- HTTP 容器 `de-issuer` 与轮询容器 `de-issuer-poller` 并存，私钥同一挂载。

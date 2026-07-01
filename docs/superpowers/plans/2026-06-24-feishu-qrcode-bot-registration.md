# 飞书扫码一键建机器人 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在"渠道"设置 tab 里加飞书区块，提供扫码一键建机器人：扫码授权→飞书自动建 PersonalAgent 应用回吐 app_id/secret/扫码人 open_id→前端回填→用户保存写 config_kvs。

**Architecture:** 后端仿 QwenPaw 的飞书 OAuth 2.0 设备授权流（RFC 8628）：轻量 `QRCodeAuthHandler` 抽象 + `FeishuQRCodeAuthHandler` + 两个通用端点（`/channels/{channel}/qrcode`、`/qrcode/status`），无状态、无写副作用。前端新增"渠道"设置 tab，飞书区块读写 config_kv + 扫码弹窗轮询回填。

**Tech Stack:** Python/FastAPI/httpx/segno(新依赖) · pytest · React/TanStack/ofetch · @workspace/ui · vitest

**设计依据:** `docs/superpowers/specs/2026-06-24-feishu-qrcode-bot-registration-design.md`

---

## 关键约定

- **后端测试**：`cd apps/server && uv run --no-sync python -m pytest <path> -v`（`--no-sync` 避免 websockets .pyd 锁）。
- **前端测试**：`cd apps/web && npm run test:unit -- <path>`（vitest 真入口；**注意 `npm run test` 跑的是 electron 测试、不是 vitest**）。React 组件测试文件加 `// @vitest-environment happy-dom`。
- **设备流端点**：`https://accounts.feishu.cn/oauth/v1/app/registration`，三步全 POST `application/x-www-form-urlencoded`。**匿名请求，不带任何已有应用凭证**。
- **分支**：`feat/orchestrator-centric`。每 Task 末尾一次 commit。
- 已知预存在失败 `test_create_user_workspace_empty` 忽略。

---

## 文件结构

**后端新增/改：**
- `apps/server/pyproject.toml` — 加 `segno`
- `apps/server/src/service/channel/qrcode_auth.py`（新）— `QRCodeAuthHandler` ABC + `FeishuQRCodeAuthHandler` + `generate_qrcode_image` + 注册表 + 纯解析 helper
- `apps/server/src/api/channel_qrcode_api.py`（新）— 2 个端点
- `apps/server/src/api/__init__.py` — 注册 router

**前端新增/改：**
- `apps/web/src/api/feishu-channel.ts`（新）— `fetchQrcode` / `pollQrcodeStatus`
- `apps/web/src/components/settings/settings-types.ts` — 加 `"channels"` tab
- `apps/web/src/routes/settings.tsx` — `settingsSearchSchema` 的 `z.enum` 加 `"channels"`（否则 `?tab=channels` 运行时 parse 抛错）
- `apps/web/src/components/settings/settings-sidebar.tsx` — 过滤逻辑改通用
- `apps/web/src/components/settings/settings-page.tsx` — 加 channels 渲染分支
- `apps/web/src/components/settings/channels-settings.tsx`（新）— 渠道 tab 容器
- `apps/web/src/components/settings/feishu-section.tsx`（新）— 飞书区块（读写 config_kv + 扫码弹窗）
- `apps/web/src/lib/feishu-whitelist.ts`（新，小工具）— open_id 追加去重纯函数（可单测）

---

## Phase A：后端

### Task A1：加 segno 依赖

- [ ] **Step 1: 加依赖**

**首选手动**（避开 websockets `.pyd` 锁）：在 `apps/server/pyproject.toml` 的 dependencies 加 `"segno>=1.6.0"`，再 `cd apps/server && uv lock`。（仅当 venv 无进程占用时可改用 `uv add segno`。）
验证：`cd apps/server && uv run --no-sync python -c "import segno; print('ok')"` → `ok`。

- [ ] **Step 2: 提交**

```bash
cd D:/code/company/digital-employe-client-web-main
git add apps/server/pyproject.toml uv.lock
git commit -m "chore(deps): 加 segno（二维码生成，扫码建机器人用）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A2：qrcode_auth.py（设备流 handler + 纯解析 helper）

**Files:** Create `apps/server/src/service/channel/qrcode_auth.py` · Test `apps/server/tests/test_feishu_qrcode_auth.py`

- [ ] **Step 1: 写失败测试（聚焦纯解析 helper + 二维码生成）**

```python
# tests/test_feishu_qrcode_auth.py
import base64
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
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic


def test_registry_has_feishu():
    assert "feishu" in QRCODE_AUTH_HANDLERS


def test_fetch_qrcode_orchestration(monkeypatch):
    """mock 三次 POST（init→begin），断言 scan_url 拼 source、poll_token=device_code。"""
    import httpx
    from unittest.mock import AsyncMock
    from src.service.channel.qrcode_auth import FeishuQRCodeAuthHandler

    calls = []

    class _Resp:
        def __init__(self, payload): self._p = payload
        def raise_for_status(self): pass
        def json(self): return self._p

    async def _post(url, content=None, headers=None):
        calls.append(content)
        payload = content.decode() if isinstance(content, bytes) else content
        if "action=init" in payload:
            return _Resp({"supported_auth_methods": ["client_secret"]})
        return _Resp({"device_code": "dev_X",
                      "verification_uri_complete": "https://applink.feishu.cn/x?k=1"})

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        post = staticmethod(_post)

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    import asyncio
    result = asyncio.run(FeishuQRCodeAuthHandler().fetch_qrcode())
    assert result.poll_token == "dev_X"
    assert "source=DigitalEmployee" in result.scan_url
    assert "&source=" in result.scan_url  # verification_uri 已含 ?，故用 &


def test_fetch_qrcode_unsupported_method(monkeypatch):
    import httpx, asyncio
    from src.service.channel.qrcode_auth import FeishuQRCodeAuthHandler

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return {"supported_auth_methods": []}  # 不含 client_secret

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    with pytest.raises(RuntimeError):
        asyncio.run(FeishuQRCodeAuthHandler().fetch_qrcode())
```
（测试顶部加 `import pytest`。`_post` 里判 `action=init` 的写法以实际 content 类型为准，简化即可——关键是 init 返回支持 client_secret、begin 返回 device_code/verification_uri。）

Run: `cd apps/server && uv run --no-sync python -m pytest tests/test_feishu_qrcode_auth.py -v` → FAIL（模块不存在）。

- [ ] **Step 2: 实现 qrcode_auth.py**

```python
# src/service/channel/qrcode_auth.py
from __future__ import annotations
import base64
import io
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import segno

PROJECT_NAME = "DigitalEmployee"
_FEISHU_ACCOUNTS_DOMAIN = "https://accounts.feishu.cn"
_FEISHU_REGISTER_ENDPOINT = "/oauth/v1/app/registration"
_FORM_HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}


@dataclass
class QRCodeResult:
    scan_url: str
    poll_token: str


@dataclass
class PollResult:
    status: str  # waiting | success | expired | fail
    credentials: dict[str, Any]


class QRCodeAuthHandler(ABC):
    @abstractmethod
    async def fetch_qrcode(self) -> QRCodeResult: ...
    @abstractmethod
    async def poll_status(self, token: str) -> PollResult: ...


def generate_qrcode_image(scan_url: str) -> str:
    """scan_url → base64-encoded PNG."""
    qr = segno.make(scan_url, error="M")
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=6, border=2)
    return base64.b64encode(buf.getvalue()).decode()


def _normalize_feishu_poll(data: dict[str, Any]) -> PollResult:
    """把飞书 poll 返回归一化为 waiting/success/expired/fail（纯函数，可单测）。"""
    if data.get("client_id") and data.get("client_secret"):
        user_info = data.get("user_info", {}) or {}
        return PollResult("success", {
            "app_id": data["client_id"],
            "app_secret": data["client_secret"],
            "open_id": user_info.get("open_id", ""),
        })
    error = data.get("error", "")
    if error in ("expired_token", "invalid_grant"):
        return PollResult("expired", {"fail_reason": "二维码已过期"})
    if error == "access_denied":
        return PollResult("fail", {"fail_reason": "用户拒绝授权"})
    if error and error not in ("authorization_pending", "slow_down"):
        return PollResult("fail", {"fail_reason": error})
    return PollResult("waiting", {})


class FeishuQRCodeAuthHandler(QRCodeAuthHandler):
    async def fetch_qrcode(self) -> QRCodeResult:
        import httpx
        endpoint = _FEISHU_ACCOUNTS_DOMAIN + _FEISHU_REGISTER_ENDPOINT
        async with httpx.AsyncClient(timeout=15) as client:
            init = await client.post(endpoint, content=urlencode({"action": "init"}), headers=_FORM_HEADERS)
            init.raise_for_status()
            if "client_secret" not in (init.json().get("supported_auth_methods") or []):
                raise RuntimeError("Feishu: client_secret auth not supported")
            begin = await client.post(endpoint, content=urlencode({
                "action": "begin", "archetype": "PersonalAgent",
                "auth_method": "client_secret", "request_user_info": "open_id",
            }), headers=_FORM_HEADERS)
            begin.raise_for_status()
            bd = begin.json()
            device_code = bd.get("device_code", "")
            verification_uri = bd.get("verification_uri_complete", "")
            if not device_code or not verification_uri:
                raise RuntimeError("Feishu: missing device_code or verification_uri")
            sep = "&" if "?" in verification_uri else "?"
            scan_url = f"{verification_uri}{sep}source={PROJECT_NAME}"
            return QRCodeResult(scan_url=scan_url, poll_token=device_code)

    async def poll_status(self, token: str) -> PollResult:
        import httpx
        endpoint = _FEISHU_ACCOUNTS_DOMAIN + _FEISHU_REGISTER_ENDPOINT
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(endpoint, content=urlencode({
                "action": "poll", "device_code": token,
            }), headers=_FORM_HEADERS)
            return _normalize_feishu_poll(resp.json())


QRCODE_AUTH_HANDLERS: dict[str, QRCodeAuthHandler] = {
    "feishu": FeishuQRCodeAuthHandler(),
}
```

- [ ] **Step 3: 运行确认通过**

Run: `cd apps/server && uv run --no-sync python -m pytest tests/test_feishu_qrcode_auth.py -v` → PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/service/channel/qrcode_auth.py apps/server/tests/test_feishu_qrcode_auth.py
git commit -m "feat(channel): 飞书扫码设备授权流 handler（RFC8628）+ 纯解析 helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A3：channel_qrcode_api.py（2 端点 + 注册）

**Files:** Create `apps/server/src/api/channel_qrcode_api.py` · Modify `apps/server/src/api/__init__.py` · Test `apps/server/tests/test_channel_qrcode_api.py`

- [ ] **Step 1: 先 Read 现有范式**

Read `apps/server/src/api/feishu_api.py`（看 `APIRouter`/`ResponseBase`/`require_capability` 用法）和 `apps/server/src/api/__init__.py`（看 `include_router` 集中注册范式）。

- [ ] **Step 2: 写失败测试**

```python
# tests/test_channel_qrcode_api.py
import pytest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.service.channel.qrcode_auth import QRCodeResult, PollResult


@pytest.fixture()
def client(monkeypatch):
    # 能力门打开：必须 patch deps 模块持有的 get_capabilities 名字
    # （require_capability 闭包用的是 src.core.deps.get_capabilities，patch runtime_capabilities 模块打不中）
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
```

Run: `cd apps/server && uv run --no-sync python -m pytest tests/test_channel_qrcode_api.py -v` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 channel_qrcode_api.py**

```python
# src/api/channel_qrcode_api.py
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from src.core.deps import require_capability
from src.models.response import ResponseBase
from src.service.channel.qrcode_auth import QRCODE_AUTH_HANDLERS, generate_qrcode_image

router = APIRouter(
    tags=["渠道"],
    dependencies=[Depends(require_capability("feishu_platform"))],
)


def _require_handler(channel: str):
    handler = QRCODE_AUTH_HANDLERS.get(channel)
    if handler is None:
        raise HTTPException(status_code=404, detail=f"未知渠道：{channel}")
    return handler


@router.get("/channels/{channel}/qrcode", summary="获取渠道扫码二维码")
async def get_channel_qrcode(channel: str) -> ResponseBase[dict[str, Any]]:
    handler = _require_handler(channel)
    try:
        result = await handler.fetch_qrcode()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取二维码失败：{exc}") from exc
    return ResponseBase(data={
        "qrcode_img": generate_qrcode_image(result.scan_url),
        "poll_token": result.poll_token,
    })


@router.get("/channels/{channel}/qrcode/status", summary="轮询渠道扫码授权状态")
async def get_channel_qrcode_status(
    channel: str, token: str = Query(...),
) -> ResponseBase[dict[str, Any]]:
    handler = _require_handler(channel)
    try:
        result = await handler.poll_status(token)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"轮询状态失败：{exc}") from exc
    return ResponseBase(data={"status": result.status, "credentials": result.credentials})
```

在 `apps/server/src/api/__init__.py` 照现有范式 `from src.api.channel_qrcode_api import router as channel_qrcode_router` + `app.include_router(channel_qrcode_router)`（以该文件实际写法为准）。

- [ ] **Step 4: 运行确认通过 + 冒烟**

Run: `cd apps/server && uv run --no-sync python -m pytest tests/test_channel_qrcode_api.py -v` → PASS。
Run: `cd apps/server && uv run --no-sync python -c "from src.server import create_app; create_app()"` → 无接线错误。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/api/channel_qrcode_api.py apps/server/src/api/__init__.py apps/server/tests/test_channel_qrcode_api.py
git commit -m "feat(api): 渠道扫码端点 /channels/{channel}/qrcode(+/status)（能力门 feishu_platform）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B：前端

### Task B1：feishu-channel.ts API + 白名单工具

**Files:** Create `apps/web/src/api/feishu-channel.ts` · `apps/web/src/lib/feishu-whitelist.ts` · Test `apps/web/src/lib/feishu-whitelist.test.ts`

- [ ] **Step 1: 写失败测试（白名单纯函数）**

```ts
// src/lib/feishu-whitelist.test.ts
import { describe, expect, it } from "vitest"
import { appendOpenId } from "./feishu-whitelist"

describe("appendOpenId", () => {
  it("appends to empty", () => {
    expect(appendOpenId("", "ou_1")).toBe("ou_1")
  })
  it("dedups (trim)", () => {
    expect(appendOpenId("ou_1, ou_2", " ou_1 ")).toBe("ou_1,ou_2")
  })
  it("adds new comma-separated", () => {
    expect(appendOpenId("ou_1", "ou_2")).toBe("ou_1,ou_2")
  })
  it("ignores empty id", () => {
    expect(appendOpenId("ou_1", "")).toBe("ou_1")
  })
})
```

Run: `cd apps/web && npm run test:unit -- src/lib/feishu-whitelist.test.ts` → FAIL。

- [ ] **Step 2: 实现工具 + API**

```ts
// src/lib/feishu-whitelist.ts
export function appendOpenId(existing: string, openId: string): string {
  const id = openId.trim()
  const list = existing.split(",").map((s) => s.trim()).filter(Boolean)
  if (!id) return list.join(",")
  if (!list.includes(id)) list.push(id)
  return list.join(",")
}
```

```ts
// src/api/feishu-channel.ts
import { request } from "@/lib/request"
import type { ApiResponse } from "./types"  // ApiResponse 在 src/api/types，参照 config-kv.ts:2

export interface QrcodeResp { qrcode_img: string; poll_token: string }
export interface PollResp {
  status: "waiting" | "success" | "expired" | "fail"
  credentials: { app_id?: string; app_secret?: string; open_id?: string; fail_reason?: string }
}

export async function fetchQrcode(channel = "feishu"): Promise<QrcodeResp> {
  const res = await request<ApiResponse<QrcodeResp>>(`/channels/${channel}/qrcode`)
  return res.data
}

export async function pollQrcodeStatus(token: string, channel = "feishu"): Promise<PollResp> {
  const res = await request<ApiResponse<PollResp>>(
    `/channels/${channel}/qrcode/status`,
    { params: { token } },
  )
  return res.data
}
```

- [ ] **Step 3: 通过 + 提交**

Run: `cd apps/web && npm run test:unit -- src/lib/feishu-whitelist.test.ts` → PASS。
```bash
git add apps/web/src/api/feishu-channel.ts apps/web/src/lib/feishu-whitelist.ts apps/web/src/lib/feishu-whitelist.test.ts
git commit -m "feat(web): feishu-channel API + 白名单 open_id 追加去重工具

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B2：渠道 tab 接线（types + sidebar + page）

**Files:** Modify `settings-types.ts` · `settings-sidebar.tsx` · `settings-page.tsx`（均在 `apps/web/src/components/settings/`）

- [ ] **Step 0: routes/settings.tsx 的 zod enum 加 "channels"**

`apps/web/src/routes/settings.tsx` 的 `settingsSearchSchema` 里 `z.enum([...])` 加 `"channels"`，否则 `?tab=channels` 进入时 `.parse` 运行时抛错、且 `tabFromSearch` 类型不含 channels。

- [ ] **Step 1: settings-types.ts**

`SettingsTab` 联合类型加 `| "channels"`；`SETTINGS_TABS` 数组加（icon 用现有飞书/插件类图标，如 `IconPlug` 或合适的）：
```ts
{ id: "channels", label: "渠道", icon: IconPlug, capability: "feishu_platform" },
```

- [ ] **Step 2: settings-sidebar.tsx 过滤改通用**

把写死的 filter 改为按各 capability 解析（hook 在组件体内调）：
```ts
const canAccount = useCapability("remote_login")
const canFeishu = useCapability("feishu_platform")
const capMap: Record<string, boolean> = {
  remote_login: canAccount,
  feishu_platform: canFeishu,
}
const tabs = SETTINGS_TABS.filter((tab) => !tab.capability || capMap[tab.capability])
```

- [ ] **Step 3: settings-page.tsx 加渲染分支**

import `ChannelsSettings`；加 `const canFeishu = useCapability("feishu_platform")`；在渲染区加：
```tsx
{activeTab === "channels" && canFeishu ? <ChannelsSettings /> : null}
```
（`ChannelsSettings` 在 Task B3 创建——本 Task 可先建一个最小占位组件让编译通过，B3 再填实；或把 B2、B3 合并实现，避免中间编译断裂。**建议 B2+B3 一起做、一起提交**。）

- [ ] **Step 4: 类型检查**

Run: `cd apps/web && npm run typecheck`（或 `pnpm typecheck`，以项目脚本为准）→ 无新错误（若 ChannelsSettings 未建会报缺失——与 B3 合并提交即可）。

### Task B3：飞书区块（channels-settings.tsx + feishu-section.tsx）

**Files:** Create `apps/web/src/components/settings/channels-settings.tsx` · `feishu-section.tsx`

- [ ] **Step 1: channels-settings.tsx（容器）**

```tsx
// 容器：后续渠道在此加区块
import { FeishuSection } from "./feishu-section"

export function ChannelsSettings() {
  return (
    <div className="flex flex-col gap-6">
      <FeishuSection />
    </div>
  )
}
```

- [ ] **Step 2: feishu-section.tsx（核心区块）**

仿 `general-settings.tsx` 范式实现，含：
- `useEffect` 初始 `getConfigKv` 回显 4 项：`FEISHU_CHANNEL_ENABLED`(开关)、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_WHITELIST_OPEN_IDS`。
- App ID / App Secret(`type=password`) / 白名单 输入框（受控 state）。
- "已启用"`Switch`。
- "保存"按钮：逐项 `setConfigKv`（4 项），`toast.success/error`。
- **"获取飞书二维码"按钮 → `Dialog`**：
  - 点开 → `fetchQrcode("feishu")` → 渲染 `<img src={"data:image/png;base64," + qrcode_img} />` + 状态文字。
  - 启动轮询：`setInterval` 每 2000ms `pollQrcodeStatus(poll_token)`：
    - `waiting` → 继续。
    - `success` → 停轮询；`setAppId(cred.app_id)`、`setAppSecret(cred.app_secret)`、`setWhitelist(appendOpenId(whitelist, cred.open_id))`；toast "已获取，请点保存"；关 Dialog。
    - `expired`/`fail` → 停轮询；置灰 + 提示 `cred.fail_reason`。
  - **护栏**：总超时 5 分钟（记起始时间，超时停轮询按过期处理）；Dialog 关闭 / 组件卸载 `useEffect cleanup` 清 `clearInterval`；单次 poll 异常计数，连续 3 次失败才停。
- 顶部/保存附近一行小字提示：**"保存后需重启应用生效"**。

> 此组件交互重（弹窗+轮询+回填），**靠手测**冒烟，不强求组件单测；纯逻辑（白名单追加）已在 B1 覆盖。实现时注意：`setInterval` 句柄存 `useRef`，所有退出路径都 `clearInterval`，避免泄漏。

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/web && npm run typecheck` → 无错。
（若有 lint：`pnpm lint --filter=web`。）

- [ ] **Step 4: 提交（B2+B3 合并）**

```bash
git add apps/web/src/components/settings/settings-types.ts apps/web/src/components/settings/settings-sidebar.tsx apps/web/src/components/settings/settings-page.tsx apps/web/src/components/settings/channels-settings.tsx apps/web/src/components/settings/feishu-section.tsx
git commit -m "feat(web): 渠道设置 tab + 飞书区块（扫码弹窗轮询回填 + config_kv 读写）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C：冒烟（HUMAN GATE，需真实飞书账号）

- [ ] 启动后端 + 前端（`feishu_platform` 能力开）。设置页出现"渠道"tab，能力关时不出现。
- [ ] 飞书区块点"获取飞书二维码" → 弹窗显示二维码。
- [ ] 用飞书 App 扫码 + 确认授权 → 轮询拿到 success → App ID / App Secret 自动回填 + 扫码人 open_id 进白名单。
- [ ] 点保存 → `config_kvs` 写入 FEISHU_APP_ID/SECRET/WHITELIST_OPEN_IDS/CHANNEL_ENABLED（可在 `/config-kvs/list` 核对）。
- [ ] 二维码过期场景：等 5 分钟或不扫 → 置灰提示。
- [ ] 关弹窗 → 轮询停止（无泄漏，看 network 面板）。

> **端到端"真正连上飞书收发消息"不在本次**——等飞书 Channel 的 ws 长连接接线人工门完成后再验。本功能只验"扫码拿凭证 + 存配置"。

## 完成判据
- Phase A 单测全过；`pytest tests/ -q` 无新增失败。
- Phase B `feishu-whitelist.test.ts` 过；`npm run typecheck` 无新错。
- Phase C 冒烟清单（人工）通过。

## 后续（不在本计划）
- channel 热重载（保存即生效免重启）。
- 钉钉/企微等扫码 handler（注册表加项 + 区块）。
- 设备流真账号验证"匿名无凭证依赖"假设 + PersonalAgent scope 是否够。

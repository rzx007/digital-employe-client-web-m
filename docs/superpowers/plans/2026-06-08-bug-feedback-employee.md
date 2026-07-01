# BUG 反馈内置员工 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个默认内置数字员工「问题反馈助手」，引导用户填写 BUG、附带环境信息（可选日志），经确认后由本地 `/feedback` 端点转发到远端公司后台。

**Architecture:** 纯后端 + 一份内置技能，零前端（除 Electron 一行 env 注入）。复用现有 `login_api` 直接 httpx 转发范式（`httpx.post(feedback_url, headers={"token": …})` + 路由级 `require_capability` 离线门控）、`document_plan_tool` 的 HITL 确认卡片范式、`_BUILTIN_SEED_EMPLOYEES` 幂等 seed 范式。远端接口尚不存在，全部做成可配置占位。

**Tech Stack:** Python / FastAPI / SQLAlchemy / httpx / LangChain tools；pytest；Electron(TS)。

参考 spec：`docs/superpowers/specs/2026-06-08-bug-feedback-employee-design.md`

---

## File Structure

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `apps/server/src/core/runtime_capabilities.py` | 加 `remote_feedback` 能力位 | 改 |
| `apps/server/src/core/config.py` | `FEEDBACK_PATH` kv → `feedback_url` 字段 | 改 |
| `apps/server/src/service/feedback_service.py` | 采集环境/日志、组装载荷、httpx 转发 | 新建 |
| `apps/server/src/api/feedback_api.py` | `POST /feedback` 端点（离线门控 + token 转发） | 新建 |
| `apps/server/src/api/__init__.py`（或 server.py 路由聚合处） | 注册 feedback 路由 | 改 |
| `apps/server/src/service/agent/bug_report_tool.py` | `submit_bug_report` 工具 + interrupt 注册 | 新建 |
| `apps/server/src/service/agent/hitl_interrupt_on.py` | 合入 `BUG_REPORT_INTERRUPT_ON` | 改 |
| `apps/server/src/service/agent/employee.py` | 把工具加进 HITL 分支 extra_tools | 改 |
| `apps/server/build-in-skills/bug-reporter/SKILL.md` | 「问题反馈助手」人设 | 新建 |
| `apps/server/src/service/employee_service.py` | `_BUILTIN_SEED_EMPLOYEES` 加一行 | 改 |
| `apps/server/src/service/local_skill_service.py` | 中文展示名（可选） | 改 |
| `apps/web/electron/features/backend/backend-process.ts` | 注入 `APP_VERSION` env | 改 |
| `apps/server/tests/test_feedback_*.py` | 测试 | 新建 |

**测试运行约定：** `cd apps/server && uv run pytest <path> -q`

---

## Task 1: `remote_feedback` 能力位

**Files:**
- Modify: `apps/server/src/core/runtime_capabilities.py`
- Test: `apps/server/tests/test_feedback_capability.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_feedback_capability.py`:

```python
from unittest.mock import patch

from src.core.runtime_capabilities import get_capabilities


def test_remote_feedback_enabled_online():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=False):
        assert get_capabilities().remote_feedback is True


def test_remote_feedback_disabled_offline():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=True):
        assert get_capabilities().remote_feedback is False
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_feedback_capability.py -q`
Expected: FAIL（`RuntimeCapabilities` 无 `remote_feedback` 字段 / AttributeError）

- [ ] **Step 3: 实现**

In `runtime_capabilities.py`：
1. dataclass 末尾（`mcp_task_execution` 之后、`activation_enforced` 之前）加字段：
```python
    mcp_task_execution: bool       # 调度器内远程 MCP 调用
    remote_feedback: bool          # /feedback 转发到远端后台（离线禁用）
    activation_enforced: bool      # 是否强制设备激活（独立于在线/离线远程能力）
```
2. 离线分支显式加 `remote_feedback=False`（在 `mcp_task_execution=False,` 之后）。
3. 在线分支位置参数计数 `*(True,) * 10` 改为 `*(True,) * 11`：
```python
    return RuntimeCapabilities(*(True,) * 11, activation_enforced=activation)
```

> ⚠️ 必须同时改这三处，否则位置参数错位会静默 break。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_feedback_capability.py -q`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/runtime_capabilities.py apps/server/tests/test_feedback_capability.py
git commit -m "feat(feedback): add remote_feedback runtime capability"
```

---

## Task 2: 配置 `feedback_url`

**Files:**
- Modify: `apps/server/src/core/config.py`
- Test: `apps/server/tests/test_feedback_config.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_feedback_config.py`:

```python
from src.core.config import join_base_and_path


def test_feedback_url_joins_base_and_path():
    assert (
        join_base_and_path("https://api.example.com", "/yc/feedback")
        == "https://api.example.com/yc/feedback"
    )


def test_settings_has_feedback_url_field():
    from src.core.config import Settings

    assert "feedback_url" in Settings.model_fields
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_feedback_config.py -q`
Expected: FAIL（`feedback_url` 不在 Settings 字段）

- [ ] **Step 3: 实现**

In `config.py`：
1. Settings 字段区（`register_url` 附近）加：`feedback_url: str | None = None`
2. kv 解析区（`register_path = ...` 附近）加：
```python
    feedback_path = _get_kv_value(kv_data, "FEEDBACK_PATH") or "/yc/feedback"
```
3. Settings 构造区（`register_url=join_base_and_path(...)` 附近）加：
```python
        feedback_url=join_base_and_path(platform_base_url, feedback_path),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_feedback_config.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/config.py apps/server/tests/test_feedback_config.py
git commit -m "feat(feedback): add FEEDBACK_PATH -> feedback_url setting"
```

---

## Task 3: `feedback_service`（采集 + 转发）

**Files:**
- Create: `apps/server/src/service/feedback_service.py`
- Test: `apps/server/tests/test_feedback_service.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_feedback_service.py`:

```python
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
    assert out.count("line") <= 30  # app.log 尾部 + error.log（不存在）
    assert "line1999" in out


def test_submit_feedback_errors_when_unconfigured(monkeypatch):
    monkeypatch.setattr(
        feedback_service, "_feedback_url", lambda: None
    )
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_feedback_service.py -q`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

Create `apps/server/src/service/feedback_service.py`:

```python
"""BUG 反馈：采集环境/日志、组装载荷、转发到远端后台（与 login_api 同范式）。"""
from __future__ import annotations

import logging
import platform

import httpx

from src.core.config import get_default_logs_dir, get_settings, is_offline_mode

logger = logging.getLogger(__name__)

_LOG_DIR = get_default_logs_dir()
_LOG_FILES = ("app.log", "error.log")


def _feedback_url() -> str | None:
    return (get_settings().feedback_url or "").strip() or None


def collect_env() -> dict:
    """自动采集环境信息（app 版本经 Electron 注入 APP_VERSION；缺失退化 unknown）。"""
    import os

    return {
        "app_version": os.getenv("APP_VERSION") or "unknown",
        "os": platform.system(),
        "arch": platform.machine(),
        "offline": is_offline_mode(),
    }


def collect_logs(cap_lines: int = 500, cap_bytes: int = 200_000) -> str | None:
    """读取 app.log + error.log 末尾，按行/字节双封顶。文件缺失返回 None。"""
    chunks: list[str] = []
    for name in _LOG_FILES:
        path = _LOG_DIR / name
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        tail = "\n".join(lines[-cap_lines:])
        chunks.append(f"===== {name} (尾部 {min(len(lines), cap_lines)} 行) =====\n{tail}")
    if not chunks:
        return None
    text = "\n\n".join(chunks)
    if len(text) > cap_bytes:
        text = text[-cap_bytes:]
    return text


def submit_feedback(payload: dict, token: str | None) -> dict:
    """转发上报到远端后台。返回 {ok, message, remote?}，不抛异常给调用方。"""
    if is_offline_mode():
        return {"ok": False, "message": "离线模式下无法上报反馈，请联网后重试。"}
    url = _feedback_url()
    if not url:
        return {"ok": False, "message": "反馈服务未配置（缺少 REMOTE_API_BASE_URL/FEEDBACK_PATH）。"}
    headers = {"token": token} if token else None
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=30.0)
        resp.raise_for_status()
        return {"ok": True, "message": "已提交反馈。", "remote": resp.json()}
    except httpx.HTTPError as exc:
        logger.error("feedback 转发失败: %s", exc, exc_info=True)
        return {"ok": False, "message": "上报失败：网络不可达或服务异常，请稍后重试。"}
    except ValueError:
        return {"ok": True, "message": "已提交反馈。", "remote": None}
```

> 注：`get_default_logs_dir` 在 `config.py:32`；若导入名不同，按实际调整。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_feedback_service.py -q`
Expected: PASS（7 passed）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/feedback_service.py apps/server/tests/test_feedback_service.py
git commit -m "feat(feedback): add feedback_service (collect env/logs + remote forward)"
```

---

## Task 4: `POST /feedback` 端点

**Files:**
- Create: `apps/server/src/api/feedback_api.py`
- Modify: 路由聚合处（`apps/server/src/api/__init__.py` 的 `api_router`，参照 login_api 如何被 include）
- Test: `apps/server/tests/test_feedback_api.py`

- [ ] **Step 0: 先确认 login 路由是怎么挂进 `api_router` 的**

Run: `cd apps/server && grep -rn "login_api\|include_router\|api_router" src/api/__init__.py`
按同样方式把 `feedback_api.router` include 进去。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_feedback_api.py`:

```python
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.feedback_api import router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_feedback_blocked_offline():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=True):
        resp = _client().post("/feedback", json={"title": "x"})
    assert resp.status_code == 503


def test_feedback_forwards_online_with_token():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=False), \
         patch("src.api.feedback_api.feedback_service.submit_feedback",
               return_value={"ok": True, "message": "ok", "remote": {"ticket": "B-1"}}) as sf:
        resp = _client().post(
            "/feedback", json={"title": "x"}, headers={"token": "tok"}
        )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    _, kwargs = sf.call_args
    assert kwargs.get("token") == "tok" or sf.call_args[0][1] == "tok"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_feedback_api.py -q`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

Create `apps/server/src/api/feedback_api.py`（以 `login_api.register_proxy` 为模板）：

```python
import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, Request

from src.core.deps import require_capability
from src.service import feedback_service

router = APIRouter(tags=["反馈"])
logger = logging.getLogger(__name__)


@router.post(
    "/feedback",
    summary="提交 BUG 反馈（转发远端）",
    response_model=dict[str, Any],
    dependencies=[Depends(require_capability("remote_feedback"))],
)
def submit_feedback_endpoint(request: Request, body: dict[str, Any] = Body(...)):
    token = (request.headers.get("token") or "").strip() or None
    return feedback_service.submit_feedback(body, token=token)
```

然后在 `api/__init__.py` 把 `feedback_api.router` include 进 `api_router`（与 login 同处、同写法）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_feedback_api.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/api/feedback_api.py apps/server/src/api/__init__.py apps/server/tests/test_feedback_api.py
git commit -m "feat(feedback): add POST /feedback endpoint (offline-gated, forwards)"
```

---

## Task 5: `submit_bug_report` 工具 + HITL 注册 + 接线

**Files:**
- Create: `apps/server/src/service/agent/bug_report_tool.py`
- Modify: `apps/server/src/service/agent/hitl_interrupt_on.py`
- Modify: `apps/server/src/service/agent/employee.py:225`
- Test: `apps/server/tests/test_bug_report_tool.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_bug_report_tool.py`:

```python
from unittest.mock import patch

from src.service.agent.bug_report_tool import (
    BUG_REPORT_INTERRUPT_ON,
    submit_bug_report,
)
from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON


def test_interrupt_registered():
    assert "submit_bug_report" in BUG_REPORT_INTERRUPT_ON
    assert "submit_bug_report" in HITL_INTERRUPT_ON


def test_submit_invokes_service_and_reports_result():
    with patch(
        "src.service.agent.bug_report_tool.feedback_service.submit_feedback",
        return_value={"ok": True, "message": "已提交反馈。", "remote": {"ticket": "B-9"}},
    ) as sf:
        out = submit_bug_report.invoke({
            "title": "崩溃",
            "description": "点击导出闪退",
            "repro_steps": "1.打开 2.点导出",
            "expected": "导出成功",
            "actual": "闪退",
            "include_logs": False,
        })
    assert "已提交" in out
    assert "B-9" in out
    payload = sf.call_args[0][0]
    assert payload["title"] == "崩溃"
    assert "env" in payload
    assert "logs" not in payload  # include_logs=False 不带日志


def test_submit_attaches_logs_when_requested():
    with patch(
        "src.service.agent.bug_report_tool.feedback_service.collect_logs",
        return_value="LOGCONTENT",
    ), patch(
        "src.service.agent.bug_report_tool.feedback_service.submit_feedback",
        return_value={"ok": True, "message": "已提交反馈。", "remote": None},
    ) as sf:
        submit_bug_report.invoke({
            "title": "t", "description": "d", "repro_steps": "",
            "expected": "", "actual": "", "include_logs": True,
        })
    assert sf.call_args[0][0]["logs"] == "LOGCONTENT"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_bug_report_tool.py -q`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现工具**

Create `apps/server/src/service/agent/bug_report_tool.py`（仿 `document_plan_tool.py`）：

```python
from __future__ import annotations

import logging

from langchain_core.tools import tool

from src.service import feedback_service

logger = logging.getLogger(__name__)

BUG_REPORT_INTERRUPT_ON = {
    "submit_bug_report": {
        "allowed_decisions": ["approve", "reject", "edit"],
    },
}


def _best_effort_token() -> str | None:
    """尽力从编排运行时取当前用户 token；取不到返回 None（远端按需识别）。"""
    try:
        from src.service.agent.orchestrator import runtime

        getter = getattr(runtime, "get_auth_token", None)
        if callable(getter):
            return (getter() or "").strip() or None
    except Exception:
        pass
    return None


@tool
def submit_bug_report(
    title: str,
    description: str,
    repro_steps: str = "",
    expected: str = "",
    actual: str = "",
    include_logs: bool = False,
) -> str:
    """提交一条 BUG 反馈到官方后台（用户确认后才会真正发送）。

    title: 一句话标题；description: 详细描述；repro_steps: 复现步骤；
    expected/actual: 期望与实际；include_logs: 是否附带最近运行日志（须用户同意）。
    """
    payload: dict = {
        "title": title,
        "description": description,
        "repro_steps": repro_steps,
        "expected": expected,
        "actual": actual,
        "env": feedback_service.collect_env(),
    }
    if include_logs:
        logs = feedback_service.collect_logs()
        if logs:
            payload["logs"] = logs

    result = feedback_service.submit_feedback(payload, token=_best_effort_token())
    if result.get("ok"):
        remote = result.get("remote") or {}
        ticket = remote.get("ticket") if isinstance(remote, dict) else None
        return f"已提交反馈。{('工单号：' + str(ticket)) if ticket else ''}".strip()
    return f"反馈未提交：{result.get('message', '未知错误')}"
```

> `_best_effort_token`：执行者需确认普通员工会话里取 token 的真实入口（orchestrator runtime 是否对单聊也设了 auth_token）。取不到不阻断上报。

- [ ] **Step 4: 注册 interrupt**

In `hitl_interrupt_on.py`：
```python
from src.service.agent.clarifying_questions_tool import CLARIFYING_QUESTIONS_INTERRUPT_ON
from src.service.agent.document_plan_tool import DOCUMENT_PLAN_INTERRUPT_ON
from src.service.agent.bug_report_tool import BUG_REPORT_INTERRUPT_ON

HITL_INTERRUPT_ON = {
    **CLARIFYING_QUESTIONS_INTERRUPT_ON,
    **DOCUMENT_PLAN_INTERRUPT_ON,
    **BUG_REPORT_INTERRUPT_ON,
}
```

- [ ] **Step 5: 接线进 employee 工具集**

In `employee.py`：
1. 顶部 import：`from src.service.agent.bug_report_tool import submit_bug_report`
2. line 225 改为（在 HITL 分支内加入）：
```python
    if enable_hitl or clarify_only_hitl:
        extra_tools.extend(
            [submit_clarifying_questions, submit_document_plan, submit_bug_report]
        )
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_bug_report_tool.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/service/agent/bug_report_tool.py apps/server/src/service/agent/hitl_interrupt_on.py apps/server/src/service/agent/employee.py apps/server/tests/test_bug_report_tool.py
git commit -m "feat(feedback): add submit_bug_report HITL tool + wire into employee"
```

---

## Task 6: 内置员工技能 `SKILL.md`

**Files:**
- Create: `apps/server/build-in-skills/bug-reporter/SKILL.md`

- [ ] **Step 1: 写 SKILL.md**

Create `apps/server/build-in-skills/bug-reporter/SKILL.md`:

```markdown
---
name: bug-reporter
description: 收集用户遇到的问题（BUG），整理后提交到官方后台。
---

# 角色
你是「问题反馈助手」数字员工，专职帮用户把遇到的 BUG 说清楚并提交到官方后台。

# 工作流（严格遵守）
1. 友好询问、引导用户说清以下要点（缺则追问，不要替用户编造）：
   - 标题（一句话）
   - 问题描述（发生了什么）
   - 复现步骤（怎么操作会出现）
   - 期望结果 vs 实际结果
2. 明确询问："是否附带最近的运行日志帮助定位？日志可能包含你近期的操作信息。"默认不附带。
3. 调用工具 `submit_bug_report`，传入上述字段与 include_logs。
   - 该工具会弹出**确认卡片**，由用户点「确认提交」后才真正发送——你不要替用户确认。
4. 根据工具返回，告知用户提交成功（含工单号）或失败原因。

# 注意
- 不要编造复现步骤或环境信息；环境信息由工具自动采集。
- 一次反馈只调用一次 `submit_bug_report`。
- 离线/未配置反馈服务时，如实把工具返回的失败原因转达用户。
```

- [ ] **Step 2: 验证 frontmatter 可被 seed 识别**

Run: `cd apps/server && uv run python -c "from pathlib import Path; p=Path('build-in-skills/bug-reporter/SKILL.md'); print(p.is_file()); print(p.read_text(encoding='utf-8').splitlines()[1])"`
Expected: `True` 然后 `name: bug-reporter`

- [ ] **Step 3: Commit**

```bash
git add apps/server/build-in-skills/bug-reporter/SKILL.md
git commit -m "feat(feedback): add bug-reporter built-in skill (问题反馈助手)"
```

---

## Task 7: 默认员工 seed + 中文展示名

**Files:**
- Modify: `apps/server/src/service/employee_service.py:36-54`
- Modify: `apps/server/src/service/local_skill_service.py:23`（可选展示名）
- Test: `apps/server/tests/test_feedback_seed.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_feedback_seed.py`:

```python
from src.service.employee_service import _BUILTIN_SEED_EMPLOYEES


def test_bug_reporter_employee_seeded():
    by_name = {name: skills for name, skills, _ in _BUILTIN_SEED_EMPLOYEES}
    assert "问题反馈助手" in by_name
    assert by_name["问题反馈助手"] == ("bug-reporter",)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_feedback_seed.py -q`
Expected: FAIL（KeyError / assert）

- [ ] **Step 3: 实现**

In `employee_service.py` `_BUILTIN_SEED_EMPLOYEES` 末尾加：
```python
    (
        "问题反馈助手",
        ("bug-reporter",),
        "收集并提交 BUG 反馈到官方后台。",
    ),
```

In `local_skill_service.py` `BUILTIN_SKILL_DISPLAY_NAMES` 加：
```python
    "bug-reporter": "问题反馈",
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_feedback_seed.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/employee_service.py apps/server/src/service/local_skill_service.py apps/server/tests/test_feedback_seed.py
git commit -m "feat(feedback): seed 问题反馈助手 default employee"
```

---

## Task 8: Electron 注入 `APP_VERSION`

**Files:**
- Modify: `apps/web/electron/features/backend/backend-process.ts`（`startManagedProcess` 的 `env:` 块）

- [ ] **Step 1: 实现**

在 `env:` 块里（与 `OFFLINE_MODE` 同级）加一行：
```ts
      // 反馈上报需要 app 版本；注入供后端 feedback_service.collect_env 读取
      APP_VERSION: app.getVersion(),
```
（`app` 已在文件顶部 `import { app } from "electron"`。）

- [ ] **Step 2: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: 通过（无新错误）

- [ ] **Step 3: Commit**

```bash
git add apps/web/electron/features/backend/backend-process.ts
git commit -m "feat(feedback): inject APP_VERSION into backend env"
```

---

## Task 9: 全量回归

- [ ] **Step 1: 跑反馈相关全部测试**

Run: `cd apps/server && uv run pytest tests/test_feedback_capability.py tests/test_feedback_config.py tests/test_feedback_service.py tests/test_feedback_api.py tests/test_bug_report_tool.py tests/test_feedback_seed.py -q`
Expected: 全 PASS

- [ ] **Step 2: 冒烟（手动，可选）**

启动后端，确认 `问题反馈助手` 员工出现在列表；与其对话走完一次反馈 → 确认卡片 → 提交（未配置远端时应回"反馈服务未配置"，不崩）。

- [ ] **Step 3: 已知非本任务失败**

`tests/test_stream_registry_classes.py` 等的既有 stale 失败与本计划无关（见 task_1072a3a1），不在此修。

---

## 待远端定稿后回填
- `FEEDBACK_PATH` 真实路径、HTTP 方法、JSON 字段名 → 改 `config.py` 默认值 + `feedback_service` 载荷映射。
- 鉴权若改服务密钥 → 加配置键、改 `submit_feedback` 头。
- `_best_effort_token` 的真实 token 入口 → 按实际编排/会话 auth 上下文落实。

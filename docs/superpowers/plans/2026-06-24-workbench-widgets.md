# 工作台结构化 Widget + 多标签页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用「结构化声明式 widget 看板（首个固定标签）+ 浏览器式多标签页（钉来的 HTML 全屏标签）」替换现有写死 HTML 卡片，配置按 user 落后端。

**Architecture:** 后端新增 `workbench_config`（按 `user_id`）+ 3 个 API + `add_workbench_widget` orchestrator 工具 + 指标注册表（先接 3 个现有接口）。前端中间「网格区」改为标签区：首标签是 dnd-kit widget 网格（5 个 shadcn/ui widget 组件 + 注册表），其余是钉来的 HTML 全屏标签。配置由 localStorage 改为 react-query 读写后端。

**Tech Stack:** 后端 FastAPI + SQLAlchemy 2.0 + langchain `@tool`/deepagents + pytest。前端 React 19 + TanStack Query + dnd-kit + `@workspace/ui`(shadcn) + recharts + vitest/happy-dom。

**参考 spec:** `docs/superpowers/specs/2026-06-24-workbench-widgets-design.md`

---

## 约定（每个任务通用）

- 后端测试：`cd apps/server && pytest <path>::<test> -v`
- 前端测试：`pnpm --filter web test:unit -- <path>`（vitest run；测试文件头部加 `// @vitest-environment happy-dom`）
- 类型检查：`pnpm typecheck`；格式化：`pnpm format`
- 每个任务最后一步提交；commit message 用中文 `feat/fix(scope): ...`，结尾保留 `Co-Authored-By` 行（按仓库习惯）。
- 分支：本计划在新分支 `feat/workbench-widgets` 上执行。

---

## 文件结构总览

**后端新增/改：**
- `apps/server/src/models/workbench_config.py` — ORM 表 + pydantic schema（WorkbenchConfig/WorkbenchWidget/HtmlTab/WidgetData）
- `apps/server/src/service/workbench_service.py` — 读写 config（按 user_id）+ 校验 + append widget
- `apps/server/src/service/workbench_metrics.py` — 指标注册表 + 3 个 resolver
- `apps/server/src/api/workbench_api.py` — GET/PUT /workbench、POST resolve
- `apps/server/src/api/__init__.py` — 注册 router（改）
- `apps/server/src/service/agent/orchestrator/tools/workbench.py` — `add_workbench_widget` 工具
- `apps/server/src/service/agent/orchestrator/agent.py` — 注册工具（改）
- 测试：`apps/server/tests/test_workbench_*.py`

**前端新增/改：**
- `apps/web/src/types/workbench.ts` — 新类型（改）
- `apps/web/src/api/workbench.ts` — API client（新）
- `apps/web/src/hooks/use-workbench-config.ts` — react-query 化（改）
- `apps/web/src/hooks/use-metric-data.ts` — resolve 取数（新）
- `apps/web/src/components/workbench/widgets/` — `widget-renderer.tsx` + `kpi-widget.tsx` + `chart-widget.tsx` + `table-widget.tsx` + `progress-widget.tsx` + `list-widget.tsx`（新）
- `apps/web/src/components/workbench/workbench-tabs.tsx` — 标签区（新）
- `apps/web/src/components/workbench/draggable-workbench-grid.tsx` — 渲染 widget 而非 html（改）
- `apps/web/src/components/workbench/workbench-content-split.tsx` 与 `apps/web/src/components/chat/views/workbench-view.tsx` — 接入标签区（改）
- `apps/web/src/components/artifact/artifact-panel.tsx` — pin → htmlTab（改）
- 测试：各组件/hook `*.test.tsx`

---

# Phase A — 后端

### Task A1: Widget pydantic schema + 目录校验

**Files:**
- Create: `apps/server/src/models/workbench_config.py`
- Test: `apps/server/tests/test_workbench_schema.py`

声明 widget 目录与 config 形状，并暴露 `WIDGET_TYPES` 与 `validate_widget_spec`。`WidgetData` 不强校验内部形状（塑形由 resolver/前端负责），只校验顶层契约：`type` 合法、`data` 或 `dataSource` 至少其一、`dataSource.metricId` 在白名单。

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_workbench_schema.py
import pytest
from src.models.workbench_config import (
    WIDGET_TYPES, validate_widget_spec, WorkbenchConfig, default_config,
)

def test_widget_types_catalog():
    assert WIDGET_TYPES == {"kpi", "line", "bar", "area", "table", "progress", "list"}

def test_valid_inline_widget():
    spec = {"type": "kpi", "title": "本月销售", "data": {"items": []}}
    w = validate_widget_spec(spec, metric_whitelist={"monthly_performance"})
    assert w.type == "kpi" and w.id  # id 自动生成

def test_valid_datasource_widget():
    spec = {"type": "line", "title": "趋势", "dataSource": {"metricId": "monthly_performance"}}
    w = validate_widget_spec(spec, metric_whitelist={"monthly_performance"})
    assert w.dataSource.metricId == "monthly_performance"

def test_reject_unknown_type():
    with pytest.raises(ValueError, match="不支持的 widget type"):
        validate_widget_spec({"type": "pie", "title": "x", "data": {}}, metric_whitelist=set())

def test_reject_no_data_and_no_source():
    with pytest.raises(ValueError, match="data 或 dataSource"):
        validate_widget_spec({"type": "kpi", "title": "x"}, metric_whitelist=set())

def test_reject_unknown_metric():
    with pytest.raises(ValueError, match="未注册的指标"):
        validate_widget_spec(
            {"type": "kpi", "title": "x", "dataSource": {"metricId": "ghost"}},
            metric_whitelist={"monthly_performance"},
        )

def test_default_config_shape():
    cfg = default_config()
    assert cfg.dashboard.widgets == [] and cfg.htmlTabs == []
    assert cfg.tabOrder == ["dashboard"]
```

- [ ] **Step 2: 运行验证失败** — `cd apps/server && pytest tests/test_workbench_schema.py -v`（Expected: ImportError / FAIL）

- [ ] **Step 3: 实现**

```python
# apps/server/src/models/workbench_config.py
from __future__ import annotations
import uuid
from typing import Any, Literal
from pydantic import BaseModel, Field

WIDGET_TYPES = {"kpi", "line", "bar", "area", "table", "progress", "list"}

class WidgetDataSource(BaseModel):
    metricId: str
    params: dict[str, Any] = Field(default_factory=dict)
    refreshSec: int | None = None

class WorkbenchWidget(BaseModel):
    id: str = Field(default_factory=lambda: f"wd-{uuid.uuid4().hex[:8]}")
    type: Literal["kpi", "line", "bar", "area", "table", "progress", "list"]
    title: str
    subtitle: str | None = None
    order: int = 0
    width: int | None = None
    height: int | None = None
    data: dict[str, Any] | None = None
    dataSource: WidgetDataSource | None = None
    options: dict[str, Any] | None = None

class HtmlTabRef(BaseModel):
    conversationId: str | int
    resourcePath: str
    pinnedAt: int

class HtmlTab(BaseModel):
    id: str = Field(default_factory=lambda: f"tab-{uuid.uuid4().hex[:8]}")
    title: str
    htmlRef: HtmlTabRef

class Dashboard(BaseModel):
    widgets: list[WorkbenchWidget] = Field(default_factory=list)

class WorkbenchConfig(BaseModel):
    dashboard: Dashboard = Field(default_factory=Dashboard)
    htmlTabs: list[HtmlTab] = Field(default_factory=list)
    tabOrder: list[str] = Field(default_factory=lambda: ["dashboard"])
    activeTabId: str | None = None
    updatedAt: int = 0

def default_config() -> WorkbenchConfig:
    return WorkbenchConfig()

def validate_widget_spec(spec: dict[str, Any], metric_whitelist: set[str]) -> WorkbenchWidget:
    if spec.get("type") not in WIDGET_TYPES:
        raise ValueError(f"不支持的 widget type: {spec.get('type')}")
    if not spec.get("data") and not spec.get("dataSource"):
        raise ValueError("必须提供 data 或 dataSource 之一")
    src = spec.get("dataSource")
    if src and src.get("metricId") not in metric_whitelist:
        raise ValueError(f"未注册的指标: {src.get('metricId')}")
    return WorkbenchWidget(**spec)
```

- [ ] **Step 4: 运行通过** — `pytest tests/test_workbench_schema.py -v`（Expected: PASS）
- [ ] **Step 5: 提交** — `git add apps/server/src/models/workbench_config.py apps/server/tests/test_workbench_schema.py && git commit -m "feat(workbench): widget pydantic schema 与目录校验"`

---

### Task A2: 指标注册表 + 3 个 resolver

**Files:**
- Create: `apps/server/src/service/workbench_metrics.py`
- Test: `apps/server/tests/test_workbench_metrics.py`

注册表是**白名单单一来源**（Task A1 校验与 resolve 接口都读它）。resolver 把现有 service 输出塑形成 `WidgetData`。

- [ ] **Step 1: 写失败测试**（用 monkeypatch 桩掉底层 service，只验注册表与塑形）

```python
# apps/server/tests/test_workbench_metrics.py
import pytest
from src.service import workbench_metrics as wm

def test_metric_ids_whitelist():
    assert wm.metric_ids() == {"monthly_performance", "task_calendar", "today_tasks"}

def test_resolve_unknown_raises():
    with pytest.raises(KeyError):
        wm.resolve_metric(None, "ghost", {})

def test_monthly_performance_shapes_kpi(monkeypatch):
    async def fake(db): return {"name": "张三", "month": "2026-06", "balance": 1234.5, "gdp": 0.8, "rank": 2}
    monkeypatch.setattr(wm.PerformanceBalanceService, "get_remote_monthly_balance", staticmethod(fake))
    out = wm.resolve_metric_sync(None, "monthly_performance", {})
    assert out["items"][0]["label"] and "value" in out["items"][0]
```

- [ ] **Step 2: 运行失败** — `pytest tests/test_workbench_metrics.py -v`

- [ ] **Step 3: 实现**

```python
# apps/server/src/service/workbench_metrics.py
from __future__ import annotations
import asyncio
from typing import Any, Callable
from sqlalchemy.orm import Session
from src.service.performance_balance_service import PerformanceBalanceService
from src.service.task_service import TaskService

# metricId -> (resolver, 默认 refreshSec)
def _monthly_performance(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    data = asyncio.run(PerformanceBalanceService.get_remote_monthly_balance(db))
    return {"items": [
        {"label": "本月结算", "value": data.get("balance"), "unit": "¥"},
        {"label": "GDP系数", "value": data.get("gdp")},
        {"label": "排名", "value": data.get("rank")},
    ]}

def _task_calendar(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    payload = TaskService.build_monthly_calendar(
        db=db, user_id=params.get("user_id", "1"),
        year=params.get("year"), month=params.get("month"), employee_id=params.get("employee_id"),
    )
    rows = []
    for date, info in (payload.get("days") or {}).items():
        for run in info.get("runs", []):
            rows.append({"date": date, "title": run.get("title"), "time": run.get("time")})
    return {"columns": [
        {"key": "date", "label": "日期"}, {"key": "time", "label": "时间"}, {"key": "title", "label": "任务"},
    ], "rows": rows}

def _today_tasks(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    items = TaskService.list_today_tasks(db, params.get("workspace_id", 1))
    return {"items": [
        {"title": it.get("task_name"), "value": it.get("status"), "badge": it.get("run_status")}
        for it in items
    ]}

_REGISTRY: dict[str, Callable[[Session, dict], dict]] = {
    "monthly_performance": _monthly_performance,
    "task_calendar": _task_calendar,
    "today_tasks": _today_tasks,
}

def metric_ids() -> set[str]:
    return set(_REGISTRY)

def resolve_metric_sync(db: Session, metric_id: str, params: dict[str, Any]) -> dict[str, Any]:
    if metric_id not in _REGISTRY:
        raise KeyError(metric_id)
    return _REGISTRY[metric_id](db, params)

# 异步包装供 API 用
async def resolve_metric(db: Session, metric_id: str, params: dict[str, Any]) -> dict[str, Any]:
    return resolve_metric_sync(db, metric_id, params)
```

> 注：`asyncio.run` 仅在同步 resolver 里调异步 service；若运行上下文已有事件循环，A4 的接口改为直接 `await` 异步版本。实现者按实际 service 是否 async 调整（performance 是 async，其余是 sync）。

- [ ] **Step 4: 运行通过** — `pytest tests/test_workbench_metrics.py -v`
- [ ] **Step 5: 提交** — `git commit -m "feat(workbench): 指标注册表与3个resolver(接现有接口)"`

---

### Task A3: ORM 表 + 建表挂载

**Files:**
- Modify: `apps/server/src/models/workbench_config.py`（加 ORM 类，复用同文件）
- Modify: `apps/server/src/db/init_db.py`（确保 import 触发 create_all）
- Test: `apps/server/tests/test_workbench_store.py`（建表 + 落库 round-trip，放在 A4 一起更顺，这里先建表）

- [ ] **Step 1: 加 ORM 类**（追加到 `workbench_config.py` 底部）

```python
from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from src.db.base import Base
from src.db.types import CstDateTime
from src.models.workspace import cst_now

class WorkbenchConfigRow(Base):
    __tablename__ = "workbench_configs"
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at = mapped_column(CstDateTime, default=cst_now, onupdate=cst_now)
```

- [ ] **Step 2: 注册模型以触发建表**（**必做，否则 `create_all` 静默跳过新表、A4 round-trip 报 "no such table"**）：在 `apps/server/src/models/__init__.py` 加一行 `from src.models.workbench_config import WorkbenchConfigRow`（该包按显式 import 注册模型，`init_db.py` 走 `from src import models`）。

- [ ] **Step 3: 烟囱测试建表**

```python
# apps/server/tests/test_workbench_store.py（占位，A4 补全 round-trip）
from src.models.workbench_config import WorkbenchConfigRow
def test_table_registered():
    assert WorkbenchConfigRow.__tablename__ == "workbench_configs"
```

- [ ] **Step 4: 运行** — `pytest tests/test_workbench_store.py -v`
- [ ] **Step 5: 提交** — `git commit -m "feat(workbench): workbench_configs 表"`

---

### Task A4: service 读写 + GET/PUT/resolve API

**Files:**
- Create: `apps/server/src/service/workbench_service.py`
- Create: `apps/server/src/api/workbench_api.py`
- Modify: `apps/server/src/api/__init__.py`
- Test: `apps/server/tests/test_workbench_store.py`（补全）, `apps/server/tests/test_workbench_api.py`

**service：**

- [ ] **Step 1: 写 service 测试**

```python
# apps/server/tests/test_workbench_store.py
from src.service import workbench_service as ws
from src.models.workbench_config import WorkbenchConfigRow  # noqa

def test_load_default_when_absent(db_session):
    cfg = ws.load_config(db_session, "u1")
    assert cfg.tabOrder == ["dashboard"]

def test_save_then_load_roundtrip(db_session):
    cfg = ws.load_config(db_session, "u1")
    cfg.dashboard.widgets.append.__self__  # noop
    ws.save_config(db_session, "u1", cfg.model_copy(update={"updatedAt": 123}))
    again = ws.load_config(db_session, "u1")
    assert again.updatedAt == 123

def test_append_widget_validates_and_persists(db_session):
    w = ws.append_widget(db_session, "u1", {"type": "kpi", "title": "x", "data": {"items": []}})
    cfg = ws.load_config(db_session, "u1")
    assert cfg.dashboard.widgets[0].id == w.id
```

- [ ] **Step 2: 运行失败** — `pytest tests/test_workbench_store.py -v`

- [ ] **Step 3: 实现 service**

```python
# apps/server/src/service/workbench_service.py
from __future__ import annotations
from typing import Any
from sqlalchemy.orm import Session
from src.models.workbench_config import (
    WorkbenchConfig, WorkbenchConfigRow, default_config, validate_widget_spec,
)
from src.service.workbench_metrics import metric_ids

def load_config(db: Session, user_id: str) -> WorkbenchConfig:
    row = db.get(WorkbenchConfigRow, user_id)
    if not row:
        return default_config()
    return WorkbenchConfig.model_validate_json(row.config_json)

def save_config(db: Session, user_id: str, cfg: WorkbenchConfig) -> None:
    row = db.get(WorkbenchConfigRow, user_id)
    if not row:
        row = WorkbenchConfigRow(user_id=user_id)
        db.add(row)
    row.config_json = cfg.model_dump_json()
    db.commit()

def append_widget(db: Session, user_id: str, spec: dict[str, Any]):
    widget = validate_widget_spec(spec, metric_whitelist=metric_ids())
    cfg = load_config(db, user_id)
    widget.order = len(cfg.dashboard.widgets)
    cfg.dashboard.widgets.append(widget)
    save_config(db, user_id, cfg)
    return widget
```

- [ ] **Step 4: 运行通过** — `pytest tests/test_workbench_store.py -v`

- [ ] **Step 5: 写 API + 测试**

```python
# apps/server/src/api/workbench_api.py
from typing import Any
from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.core.request_utils import get_user_id
from src.models.workbench_config import WorkbenchConfig
from src.service import workbench_service as ws
from src.service.workbench_metrics import resolve_metric, metric_ids

router = APIRouter(tags=["工作台"])

@router.get("/workbench")
def get_workbench(request: Request, db: Session = Depends(get_db)) -> WorkbenchConfig:
    return ws.load_config(db, get_user_id(request))

@router.put("/workbench")
def put_workbench(payload: WorkbenchConfig, request: Request, db: Session = Depends(get_db)) -> WorkbenchConfig:
    ws.save_config(db, get_user_id(request), payload)
    return payload

@router.post("/workbench/metrics/{metric_id}/resolve")
async def resolve(metric_id: str, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    if metric_id not in metric_ids():
        raise HTTPException(status_code=404, detail="指标不存在")
    params = {}
    try:
        params = await request.json()
    except Exception:
        params = {}
    params.setdefault("user_id", get_user_id(request))
    return await resolve_metric(db, metric_id, params)
```

```python
# apps/server/tests/test_workbench_api.py
from fastapi.testclient import TestClient
# 复用项目已有的 app fixture（见 conftest）；若无则构造挂 api_router 的最小 app
def test_get_returns_default(client):  # client fixture from conftest
    r = client.get("/workbench", headers={"userid": "u1"})
    assert r.status_code == 200 and r.json()["tabOrder"] == ["dashboard"]

def test_resolve_unknown_404(client):
    r = client.post("/workbench/metrics/ghost/resolve", headers={"userid": "u1"}, json={})
    assert r.status_code == 404
```

> 若 conftest 无 `client` fixture，本任务先加一个挂 `api_router` 的 `TestClient` fixture（参照 `src/server.py` 的 app 装配）。

- [ ] **Step 6: 注册 router** — 在 `apps/server/src/api/__init__.py` import 并 `api_router.include_router(workbench_router)`。
- [ ] **Step 7: 运行通过** — `pytest tests/test_workbench_api.py -v`
- [ ] **Step 8: 提交** — `git commit -m "feat(workbench): config service 与 GET/PUT/resolve API"`

---

### Task A5: `add_workbench_widget` orchestrator 工具

**Files:**
- Create: `apps/server/src/service/agent/orchestrator/tools/workbench.py`
- Modify: `apps/server/src/service/agent/orchestrator/tools/__init__.py`
- Modify: `apps/server/src/service/agent/orchestrator/agent.py`（注册进 `orchestrator_tools`）
- Test: `apps/server/tests/test_workbench_tool.py`

工具用 langchain `@tool`，从 runtime 拿 `get_user_id()`，开 fresh session，调 `workbench_service.append_widget`，返回中文结果串。

- [ ] **Step 1: 写测试**（直接调底层函数，绕过 runtime context）

```python
# apps/server/tests/test_workbench_tool.py
from src.service.agent.orchestrator.tools.workbench import _add_widget_impl
def test_add_widget_impl_ok(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "kpi", "title": "销售", "data": {"items": []}})
    assert "已添加" in msg

def test_add_widget_impl_bad_type(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "pie", "title": "x", "data": {}})
    assert "错误" in msg
```

- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现**

```python
# apps/server/src/service/agent/orchestrator/tools/workbench.py
from __future__ import annotations
import json
from typing import Any
from langchain_core.tools import tool
from sqlalchemy.orm import Session
from src.db.session import get_session_local
from src.service import workbench_service as ws
from src.service.agent.orchestrator.runtime import get_user_id

def _add_widget_impl(db: Session, user_id: str, spec: dict[str, Any]) -> str:
    try:
        widget = ws.append_widget(db, user_id, spec)
    except Exception as e:  # 校验失败给模型可读反馈
        return f"错误：{e}"
    return f"已添加 widget「{widget.title}」(id={widget.id}) 到工作台。"

@tool
def add_workbench_widget(
    type: str, title: str,
    data: dict | None = None,
    data_source: dict | None = None,
    subtitle: str | None = None,
    options: dict | None = None,
) -> str:
    """向当前用户的工作台看板添加一个统计块(widget)。
    type 取值: kpi|line|bar|area|table|progress|list。
    data 与 data_source 至少给一个：data 为内联快照；data_source={"metricId": "...","params":{...}} 绑定实时指标。
    可用 metricId: monthly_performance, task_calendar, today_tasks。"""
    spec = {"type": type, "title": title, "subtitle": subtitle,
            "data": data, "dataSource": data_source, "options": options}
    spec = {k: v for k, v in spec.items() if v is not None}
    db = get_session_local()()
    try:
        return _add_widget_impl(db, get_user_id(), spec)
    finally:
        db.close()
```

- [ ] **Step 4: 注册** — `tools/__init__.py` 导出 `add_workbench_widget`；在 `agent.py` 的 `create_deep_agent(tools=[...])` **那个内联 tools 数组**里加 `_serialize_db_tool(add_workbench_widget)`（与其它 DB 工具同处，**不是**追加到非序列化的 `orchestrator_tools` 基础列表）。
- [ ] **Step 5: 运行通过** — `pytest tests/test_workbench_tool.py -v`
- [ ] **Step 6: 全量回归** — `pytest tests/ -q`（确保未破坏既有）
- [ ] **Step 7: 提交** — `git commit -m "feat(workbench): add_workbench_widget 总管工具"`

---

# Phase B — 前端类型与数据层

### Task B1: 新 TS 类型

**Files:**
- Modify: `apps/web/src/types/workbench.ts`
- Test: 无（纯类型，靠 typecheck）

- [ ] **Step 1: 替换/扩充类型**（保留 `HtmlArtifactRef`，复用为 htmlRef）

```typescript
// apps/web/src/types/workbench.ts
export type WidgetType = "kpi" | "line" | "bar" | "area" | "table" | "progress" | "list"

export interface WidgetDataSource {
  metricId: string
  params?: Record<string, unknown>
  refreshSec?: number
}

export interface WorkbenchWidget {
  id: string
  type: WidgetType
  title: string
  subtitle?: string
  order: number
  width?: number
  height?: number
  data?: Record<string, any>
  dataSource?: WidgetDataSource
  options?: Record<string, any>
}

export interface HtmlArtifactRef {
  conversationId: string | number
  resourcePath: string
  pinnedAt: number
}

export interface HtmlTab {
  id: string
  title: string
  htmlRef: HtmlArtifactRef
}

export interface WorkbenchConfig {
  dashboard: { widgets: WorkbenchWidget[] }
  htmlTabs: HtmlTab[]
  tabOrder: string[]
  activeTabId?: string
  updatedAt: number
}

export const DASHBOARD_TAB_ID = "dashboard"
```

- [ ] **Step 2: typecheck** — `pnpm typecheck`（会暴露所有旧 `WorkbenchBlock` 引用，后续任务逐一改）
- [ ] **Step 3: 提交** — `git commit -m "feat(workbench): 前端新类型(widget/htmlTab/config v2)"`

---

### Task B2: API client

**Files:**
- Create: `apps/web/src/api/workbench.ts`
- Test: 无（薄封装）

- [ ] **Step 1: 实现**

```typescript
// apps/web/src/api/workbench.ts
import { request } from "@/lib/request"
import type { WorkbenchConfig } from "@/types/workbench"

export async function fetchWorkbench(opts?: { signal?: AbortSignal }) {
  return request<WorkbenchConfig>("/workbench", { ...(opts?.signal ? { signal: opts.signal } : {}) })
}

export async function saveWorkbench(config: WorkbenchConfig) {
  return request<WorkbenchConfig>("/workbench", { method: "PUT", body: config })
}

export async function resolveMetric(metricId: string, params: Record<string, unknown> = {}) {
  return request<Record<string, any>>(`/workbench/metrics/${metricId}/resolve`, {
    method: "POST", body: params,
  })
}
```

> 注：确认 `request` 的 body 序列化方式（ofetch 自动 JSON）。`/workbench` 无需传 user id（后端从 token/header 取）。

- [ ] **Step 2: typecheck + 提交** — `git commit -m "feat(workbench): workbench API client"`

---

### Task B3: `useWorkbenchConfig` react-query 化

**Files:**
- Modify: `apps/web/src/hooks/use-workbench-config.ts`
- Modify: `apps/web/src/lib/workbench/workbench-config.ts`（保留事件常量；纯函数改为操作 v2 config；删 localStorage 读写）
- Test: `apps/web/src/lib/workbench/workbench-config.test.ts`（改为测纯函数）

把配置变更（重排/缩放/删 widget/加关 htmlTab/切 activeTab）做成对 `WorkbenchConfig` 的纯函数，hook 用 react-query 读 + mutation 防抖写。

- [ ] **Step 1: 写纯函数测试**（替换旧 localStorage 测试）

```typescript
// apps/web/src/lib/workbench/workbench-config.test.ts
import { describe, it, expect } from "vitest"
import { addHtmlTab, removeTab, reorderWidgets, removeWidget, emptyConfig } from "./workbench-config"

describe("workbench-config v2 纯函数", () => {
  it("钉 HTML 追加 tab 到 tabOrder 末尾并设 active", () => {
    const c = addHtmlTab(emptyConfig(), { conversationId: "c1", resourcePath: "/a.html", pinnedAt: 1 }, "A")
    expect(c.htmlTabs).toHaveLength(1)
    expect(c.tabOrder[c.tabOrder.length - 1]).toBe(c.htmlTabs[0].id)
    expect(c.activeTabId).toBe(c.htmlTabs[0].id)
  })
  it("关闭当前 tab 回退到 dashboard 并从 tabOrder 移除", () => {
    let c = addHtmlTab(emptyConfig(), { conversationId: "c1", resourcePath: "/a.html", pinnedAt: 1 }, "A")
    const id = c.htmlTabs[0].id
    c = removeTab(c, id)
    expect(c.htmlTabs).toHaveLength(0)
    expect(c.tabOrder).toEqual(["dashboard"])
    expect(c.activeTabId).toBe("dashboard")
  })
})
```

- [ ] **Step 2: 运行失败** — `pnpm --filter web test:unit -- src/lib/workbench/workbench-config.test.ts`

- [ ] **Step 3: 实现纯函数**（`workbench-config.ts`：保留 `WORKBENCH_CONFIG_CHANGED_EVENT`/`WORKBENCH_OPEN_RESOURCES_EVENT`/`emitWorkbenchConfigChanged`；新增 `emptyConfig/addHtmlTab/removeTab/setActiveTab/reorderTabs/reorderWidgets/removeWidget/resizeWidget`；删除所有 localStorage 读写与旧 block 函数）。`addHtmlTab` 末尾追加 id 到 tabOrder、设 activeTabId；`removeTab` 从 htmlTabs+tabOrder 删、若为当前则 active 回退相邻或 dashboard。

- [ ] **Step 4: 实现 hook**

```typescript
// apps/web/src/hooks/use-workbench-config.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { fetchWorkbench, saveWorkbench } from "@/api/workbench"
import type { WorkbenchConfig } from "@/types/workbench"
import { WORKBENCH_CONFIG_CHANGED_EVENT } from "@/lib/workbench/workbench-config"

const KEY = ["workbench", "config"]

export function useWorkbenchConfig() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: ({ signal }) => fetchWorkbench({ signal }) })

  const timer = useRef<ReturnType<typeof setTimeout>>()
  const save = useMutation({ mutationFn: saveWorkbench,
    onSuccess: (cfg) => qc.setQueryData(KEY, cfg) })

  // 防抖写 + 乐观更新
  function mutate(next: WorkbenchConfig) {
    qc.setQueryData(KEY, next)            // 乐观
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save.mutate({ ...next, updatedAt: Date.now() }), 400)
  }

  // 资源面板钉 HTML 等外部变更 → 重新拉取
  useEffect(() => {
    const h = () => qc.invalidateQueries({ queryKey: KEY })
    window.addEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, h)
    return () => window.removeEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, h)
  }, [qc])

  return { config: query.data ?? null, isLoading: query.isLoading, mutate }
}
```

> `Date.now()` 在前端运行时可用（脚本沙箱限制只针对 workflow 脚本，不影响应用代码）。

- [ ] **Step 5: 运行通过** — 同 Step 2 命令；`pnpm typecheck`
- [ ] **Step 6: 提交** — `git commit -m "feat(workbench): useWorkbenchConfig 改 react-query + 纯函数 reducer"`

---

### Task B4: `useMetricData` 取数 hook

**Files:**
- Create: `apps/web/src/hooks/use-metric-data.ts`
- Test: `apps/web/src/hooks/use-metric-data.test.tsx`

- [ ] **Step 1: 写测试**（mock resolveMetric）

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
vi.mock("@/api/workbench", () => ({ resolveMetric: vi.fn(async () => ({ items: [{ label: "x", value: 1 }] })) }))
import { useMetricData } from "./use-metric-data"

it("解析 dataSource 返回 WidgetData", async () => {
  const qc = new QueryClient()
  const wrapper = ({ children }: any) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useMetricData({ metricId: "m", refreshSec: 0 }), { wrapper })
  await waitFor(() => expect(result.current.data?.items?.[0]?.label).toBe("x"))
})
```

- [ ] **Step 2: 运行失败 → Step 3 实现**

```typescript
// apps/web/src/hooks/use-metric-data.ts
import { useQuery } from "@tanstack/react-query"
import { resolveMetric } from "@/api/workbench"
import type { WidgetDataSource } from "@/types/workbench"

export function useMetricData(src: WidgetDataSource | undefined) {
  return useQuery({
    queryKey: ["metric", src?.metricId, src?.params],
    queryFn: () => resolveMetric(src!.metricId, src!.params ?? {}),
    enabled: !!src,
    refetchInterval: src?.refreshSec ? src.refreshSec * 1000 : false,
  })
}
```

- [ ] **Step 4: 通过 → Step 5 提交** — `git commit -m "feat(workbench): useMetricData 解析+定时刷新 hook"`

---

# Phase C — Widget 组件（shadcn/ui）

> 每个组件入参 `{ widget: WorkbenchWidget; data: Record<string,any> }`（`data` 已由上层解析好：内联或 resolve 结果）。组件只负责渲染，不取数。

### Task C1: WidgetRenderer 注册表 + 未知兜底 + 取数桥接

**Files:**
- Create: `apps/web/src/components/workbench/widgets/widget-renderer.tsx`
- Test: `apps/web/src/components/workbench/widgets/widget-renderer.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { WidgetBody } from "./widget-renderer"

it("未知 type 渲染兜底卡片", () => {
  render(<WidgetBody widget={{ id: "1", type: "pie" as any, title: "X", order: 0, data: {} }} data={{}} />)
  expect(screen.getByText(/不支持的组件类型/)).toBeTruthy()
})
it("kpi type 命中 KpiWidget", () => {
  render(<WidgetBody widget={{ id: "1", type: "kpi", title: "X", order: 0, data: { items: [{ label: "L", value: 9 }] } }} data={{ items: [{ label: "L", value: 9 }] }} />)
  expect(screen.getByText("9")).toBeTruthy()
})
```

- [ ] **Step 2: 失败 → Step 3 实现**

```tsx
// apps/web/src/components/workbench/widgets/widget-renderer.tsx
import type { WorkbenchWidget } from "@/types/workbench"
import { useMetricData } from "@/hooks/use-metric-data"
import { KpiWidget } from "./kpi-widget"
import { ChartWidget } from "./chart-widget"
import { TableWidget } from "./table-widget"
import { ProgressWidget } from "./progress-widget"
import { ListWidget } from "./list-widget"

const REGISTRY: Record<string, React.ComponentType<{ widget: WorkbenchWidget; data: any }>> = {
  kpi: KpiWidget, line: ChartWidget, bar: ChartWidget, area: ChartWidget,
  table: TableWidget, progress: ProgressWidget, list: ListWidget,
}

export function WidgetBody({ widget, data }: { widget: WorkbenchWidget; data: any }) {
  const Comp = REGISTRY[widget.type]
  if (!Comp) return <div className="p-3 text-xs text-muted-foreground">不支持的组件类型: {widget.type}</div>
  return <Comp widget={widget} data={data} />
}

// 顶层：解析数据源 or 内联，再交给 WidgetBody
export function WidgetRenderer({ widget }: { widget: WorkbenchWidget }) {
  const q = useMetricData(widget.dataSource)
  const data = widget.dataSource ? q.data ?? widget.data ?? {} : widget.data ?? {}
  return <WidgetBody widget={widget} data={data} />
}
```

- [ ] **Step 4: 通过 → Step 5 提交** — `git commit -m "feat(workbench): WidgetRenderer 注册表+兜底+取数桥接"`

---

### Task C2–C6: 5 个 widget 组件

每个：写渲染测试 → 失败 → 实现（shadcn 基座）→ 通过 → 提交。下面给关键实现骨架，实现者补全样式（遵循 `cn()`、无分号、双引号、Tailwind）。

**C2 `kpi-widget.tsx`** — `Card` + 大数字 + `Badge` 涨跌（`deltaDir` → 箭头 `@tabler/icons-react`）。
**C3 `chart-widget.tsx`** — 按 `widget.type` 选 `LineChart/AreaChart/BarChart`（recharts，经 `@workspace/ui/components/chart` 的 `ChartContainer`/`ChartTooltip`/`ChartLegend`）；`ChartConfig` 由 `data.series` 映射 `{key→{label,color}}`；x 轴用 `data.xKey`。
**C4 `table-widget.tsx`** — `@workspace/ui/components/table`，列由 `data.columns`，行 `data.rows`。
**C5 `progress-widget.tsx`** — `Card` + 多条 `Progress`（`value/max`）。
**C6 `list-widget.tsx`** — `Card` + 列表项（title/value/`Badge`）。

各任务示例（以 C2 为模板）：

- [ ] **C2 Step 1: 测试**

```tsx
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react"
import { it, expect } from "vitest"
import { KpiWidget } from "./kpi-widget"
it("渲染 kpi items", () => {
  render(<KpiWidget widget={{ id: "1", type: "kpi", title: "销售", order: 0 } as any}
    data={{ items: [{ label: "本月", value: 1234, unit: "¥", deltaDir: "up", delta: "5%" }] }} />)
  expect(screen.getByText("销售")).toBeTruthy()
  expect(screen.getByText(/1234/)).toBeTruthy()
})
```

- [ ] **C2 Step 2–3: 失败 → 实现**

```tsx
// apps/web/src/components/workbench/widgets/kpi-widget.tsx
import { IconArrowUp, IconArrowDown, IconMinus } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import type { WorkbenchWidget } from "@/types/workbench"

const ARROW = { up: IconArrowUp, down: IconArrowDown, flat: IconMinus }

export function KpiWidget({ widget, data }: { widget: WorkbenchWidget; data: any }) {
  const items: any[] = data?.items ?? []
  return (
    <Card className="h-full">
      <CardHeader className="pb-2"><CardTitle className="text-sm">{widget.title}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {items.map((it, i) => {
          const Arrow = it.deltaDir ? ARROW[it.deltaDir as keyof typeof ARROW] : null
          return (
            <div key={i} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{it.label}</span>
              <span className="text-2xl font-semibold tabular-nums">{it.unit}{it.value}</span>
              {it.delta != null && (
                <Badge variant="secondary" className="w-fit gap-0.5">
                  {Arrow && <Arrow className="size-3" />}{it.delta}
                </Badge>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
```

- [ ] **C2 Step 4–5: 通过 → 提交** — `git commit -m "feat(workbench): KpiWidget"`
- [ ] **C3–C6**: 同模板各自一个任务/提交（`feat(workbench): ChartWidget/TableWidget/ProgressWidget/ListWidget`）。

---

# Phase D — 标签区与集成

### Task D1: 改 `DraggableWorkbenchGrid` 渲染 widget

**Files:**
- Modify: `apps/web/src/components/workbench/draggable-workbench-grid.tsx`
- Test: `apps/web/src/components/workbench/draggable-workbench-grid.test.tsx`（新，渲染冒烟）

把内部 `ResizableHtmlBlock` 渲染的 `WorkbenchHtmlPanel` 换成 `WidgetRenderer`；props 从 `blocks: WorkbenchBlock[]` 改为 `widgets: WorkbenchWidget[]`，回调改名（`onReorder/onRemove/onResize` 入参用 widget id）。保留 dnd-kit/缩放逻辑。

- [ ] **Step 1: 渲染测试**（给 1 个 kpi widget，断言标题出现、删除按钮触发回调）
- [ ] **Step 2: 失败 → Step 3 实现改造**（替换 import 与渲染点；`SortableBlock` 内 `<WidgetRenderer widget={widget} />`）
- [ ] **Step 4: 通过 → Step 5 提交** — `git commit -m "feat(workbench): 网格渲染结构化 widget"`

---

### Task D2: `WorkbenchTabs` 标签区

**Files:**
- Create: `apps/web/src/components/workbench/workbench-tabs.tsx`
- Test: `apps/web/src/components/workbench/workbench-tabs.test.tsx`

标签栏：按 `config.tabOrder` 渲染；`dashboard` 标签固定首位、无关闭按钮、不可拖动；HTML 标签可关闭（×）。内容区：当前 active 标签是 `dashboard` → 渲染 `DraggableWorkbenchGrid(widgets)`；否则 → 全屏 `WorkbenchHtmlPanel(htmlRef)`。点击标签 = `setActiveTab`；关闭 = `removeTab`。所有变更经 `useWorkbenchConfig().mutate`。

- [ ] **Step 1: 测试**

```tsx
// @vitest-environment happy-dom
import { render, screen, fireEvent } from "@testing-library/react"
import { it, expect, vi } from "vitest"
import { WorkbenchTabs } from "./workbench-tabs"

const base = { dashboard: { widgets: [] }, htmlTabs: [{ id: "tab-1", title: "报表", htmlRef: { conversationId: "c", resourcePath: "/r.html", pinnedAt: 1 } }], tabOrder: ["dashboard", "tab-1"], activeTabId: "dashboard", updatedAt: 0 }

it("dashboard 标签无关闭按钮且首位", () => {
  render(<WorkbenchTabs config={base as any} onChange={vi.fn()} />)
  expect(screen.getByRole("tab", { name: /工作台/ })).toBeTruthy()
  // dashboard tab 不应有 close 按钮（用 testid 区分）
  expect(screen.queryByTestId("close-dashboard")).toBeNull()
})
it("点 HTML 标签切换并渲染全屏 iframe 容器", () => {
  const onChange = vi.fn()
  render(<WorkbenchTabs config={base as any} onChange={onChange} />)
  fireEvent.click(screen.getByRole("tab", { name: /报表/ }))
  expect(onChange).toHaveBeenCalled()  // setActiveTab → mutate
})
```

- [ ] **Step 2: 失败 → Step 3 实现**（用 `@workspace/ui/components/tabs` 或自绘标签条；内容区按 active 分支；HTML 标签复用 `WorkbenchHtmlPanel`，容器 `className="h-full w-full"` 占满内容区）。
- [ ] **Step 4: 通过 → Step 5 提交** — `git commit -m "feat(workbench): 浏览器式多标签区"`

---

### Task D3: 接入 `WorkbenchContentSplit` / `workbench-view`

**Files:**
- Modify: `apps/web/src/components/workbench/workbench-view.tsx`（组装 `useWorkbenchConfig` + `WorkbenchTabs` 作为中间 panel 的 children）
- Modify: `apps/web/src/components/workbench/workbench-content-split.tsx`（若需要：grid panel 标题/空态文案）
- Test: 手动冒烟（见 Task D6）

- [ ] **Step 1**: `workbench-view.tsx` 用 `const { config, mutate } = useWorkbenchConfig()`，把 `<WorkbenchTabs config={config} onChange={mutate} />` 作为中间区 children；loading 时占位。
- [ ] **Step 2**: 删除对旧 `WorkbenchBlock`/旧 hook API 的引用。`pnpm typecheck` 必须过。
- [ ] **Step 3: 提交** — `git commit -m "feat(workbench): 工作台视图接入标签区+后端配置"`

---

### Task D4: pin → htmlTab

**Files:**
- Modify: `apps/web/src/components/artifact/artifact-panel.tsx`（`pinHtmlToWorkbench`）
- Test: 手动冒烟

把 `pinHtmlToWorkbench` 改为：拉当前 config（或经一个共享 mutate 入口）→ `addHtmlTab` → `saveWorkbench` → `emitWorkbenchConfigChanged()`（触发 hook 重新拉取并切到新标签）。最简实现：直接 `await fetchWorkbench()` → `addHtmlTab` → `await saveWorkbench()` → emit。

- [ ] **Step 1**: 改 `pinHtmlToWorkbench` 调用链（用 `@/api/workbench` + `@/lib/workbench/workbench-config` 的 `addHtmlTab`）。
- [ ] **Step 2**: toast 文案保留「已钉到工作台」。`pnpm typecheck`。
- [ ] **Step 3: 提交** — `git commit -m "feat(workbench): 资源管理器钉HTML→新建全屏标签"`

---

### Task D5: 清理旧代码

**Files:**
- Modify/Delete: `apps/web/src/components/workbench/workbench-html-panel.tsx`（**保留**——HTML 标签仍用它）
- Delete: 旧 `WorkbenchBlock` 相关死代码（`addHtmlArtifactBlock/updateBlockOrder/removeBlock/updateBlockSize/loadWorkbenchConfig/saveWorkbenchConfig/initializeWorkbenchConfig` 及 localStorage 逻辑、`GLOBAL_WORKBENCH_ID` 若无引用）
- Test: 全量 `pnpm --filter web test:unit`

- [ ] **Step 1**: grep `WorkbenchBlock`、`html-artifact`、`GLOBAL_WORKBENCH_ID`、`loadWorkbenchConfig` 确认无残留引用后删除。
- [ ] **Step 2**: `pnpm typecheck && pnpm --filter web test:unit && pnpm lint`
- [ ] **Step 3: 提交** — `git commit -m "refactor(workbench): 移除 localStorage 旧 block 路径"`

---

### Task D6: 集成冒烟 + 验收

**Files:** 无（手动 + 文档）

- [ ] **Step 1**: 起后端 `pnpm dev:server` + 前端 `pnpm dev`。
- [ ] **Step 2**: 让总管调用 `add_workbench_widget` 生成一个 `kpi`（内联）与一个 `dataSource: today_tasks` 的 widget；确认 dashboard 标签出现、实时 widget 会刷新。
- [ ] **Step 3**: 资源管理器右键 HTML「钉到工作台」→ 新标签出现、全屏展示、可关闭；dashboard 标签恒首位不可关。
- [ ] **Step 4**: 刷新页面，配置从后端恢复（含 activeTabId、widget 顺序/尺寸）。
- [ ] **Step 5**: 拖拽/缩放/删 widget 后等待防抖，刷新校验已落库。
- [ ] **Step 6**: `pnpm typecheck && pnpm lint && pnpm --filter web test:unit` 与 `cd apps/server && pytest tests/ -q` 全绿。
- [ ] **Step 7**: 用 superpowers:requesting-code-review 走一轮评审，按反馈修。

---

## 风险与备注

- **resolver 异步/事件循环**：performance service 是 async；在同步 resolver 里用 `asyncio.run` 可能与既有运行循环冲突。A2/A4 实现者优先把 resolve 接口端到端做成 async（API 已是 `async def`），同步桩仅供单测。
- **`request` body 约定**：B2 落地时核对 `@/lib/request`(ofetch) 的 `method/body` 用法（是否需 `JSON.stringify`）。
- **后端 client fixture**：A4 若 conftest 无 `client`，先加 TestClient fixture（挂 `api_router`）。
- **TestClient + asyncio.run 冲突**：若 resolve 在 TestClient 下因事件循环报错，改用 httpx AsyncClient 或把底层 service 调用包装为线程执行。

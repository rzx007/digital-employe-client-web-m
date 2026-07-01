# Datetime 时区归一化（P0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加 `CstDateTime` TypeDecorator 让全库 datetime 列读出恒为 CST-aware，根除 naive/aware `TypeError` bug 类，并清理 4 处旧补丁。

**Architecture:** SQLite 不存时区 → 自定义 `TypeDecorator`：写入归一到 CST 墙上时间（naive 存盘），读出补回 CST tzinfo。CST/cst_now 下沉到中立模块破循环 import。全库 `DateTime(timezone=True)` 换成 `CstDateTime`。无数据迁移、可回滚。

**Tech Stack:** Python 3 / SQLAlchemy 2.x / SQLite / Pydantic v2 / pytest（内存 SQLite）。

**Spec:** [docs/superpowers/specs/2026-06-23-datetime-tz-normalization-design.md](../specs/2026-06-23-datetime-tz-normalization-design.md)

---

## 关键约定
- 后端路径相对 `apps/server/`；测试 `cd apps/server && uv run pytest <path> -v`。
- 基线：后端 `1 failed, 1032 passed`（预存 `test_create_user_workspace_empty`）。每任务零新增 failed。
- 显式 `git add <文件>`，禁 `git add -A`。提交结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- `CST = timezone(timedelta(hours=8))`（固定偏移）。

---

### Task 1: CST/cst_now 下沉到 `src/core/cst.py`（破循环 import，不破既有调用点）

**Files:** Create `src/core/cst.py`. Modify `src/models/workspace.py`. Test: NEW `tests/test_cst_datetime.py`.

- [ ] **Step 1: 失败测试**

新建 `tests/test_cst_datetime.py`：
```python
def test_cst_and_cst_now_importable_from_core_and_workspace():
    from src.core.cst import CST, cst_now
    from src.models.workspace import CST as CST2, cst_now as cst_now2
    from datetime import timezone, timedelta
    assert CST == timezone(timedelta(hours=8))
    assert CST is CST2 and cst_now is cst_now2  # re-export 同一对象
    assert cst_now().tzinfo == CST
```

- [ ] **Step 2: 跑确认失败** → `cd apps/server && uv run pytest tests/test_cst_datetime.py::test_cst_and_cst_now_importable_from_core_and_workspace -v` → FAIL（`src.core.cst` 不存在）。

- [ ] **Step 3: 实现**
- READ `src/models/workspace.py` 顶部，确认 `CST`/`cst_now` 现定义（约 line 11-15）。
- 新建 `src/core/cst.py`，把 `CST` 与 `cst_now()` 的定义**搬**过去（仅依赖 stdlib `datetime`）：
```python
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))


def cst_now() -> datetime:
    return datetime.now(CST)
```
- `src/models/workspace.py`：删除原定义，改为 re-export `from src.core.cst import CST, cst_now`（放在文件顶部 import 区，保证 `from src.models.workspace import CST, cst_now` 的全部既有调用点不破）。

- [ ] **Step 4: 通过 + 回归** → `uv run pytest tests/test_cst_datetime.py -v && uv run pytest -q`（1 failed 预存、零新增）。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/core/cst.py apps/server/src/models/workspace.py apps/server/tests/test_cst_datetime.py
git commit -m "refactor(time): CST/cst_now 下沉 src/core/cst.py + workspace re-export（破循环import）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `CstDateTime` TypeDecorator + 类型单测（TDD）

**Files:** Create `src/db/types.py`. Test: APPEND `tests/test_cst_datetime.py`.

- [ ] **Step 1: 失败测试**
```python
def test_cstdatetime_bind_and_result_roundtrip():
    from src.db.types import CstDateTime
    from src.core.cst import CST
    from datetime import datetime, timezone, timedelta
    t = CstDateTime()
    # bind: aware → 归一 CST → naive 存盘
    aware_utc = datetime(2026, 6, 23, 5, 43, 20, tzinfo=timezone.utc)  # =13:43:20 CST
    bound = t.process_bind_param(aware_utc, None)
    assert bound.tzinfo is None and bound.hour == 13 and bound.minute == 43
    # bind: naive 视为 CST 本地，原样存
    naive = datetime(2026, 6, 23, 13, 43, 20)
    assert t.process_bind_param(naive, None) == naive
    # bind/result: None
    assert t.process_bind_param(None, None) is None
    assert t.process_result_value(None, None) is None
    # result: naive 读出补 CST
    r = t.process_result_value(naive, None)
    assert r.tzinfo == CST and r.hour == 13
    # result: 万一 aware（非SQLite）→ astimezone(CST)
    r2 = t.process_result_value(aware_utc, None)
    assert r2.tzinfo == CST and r2.hour == 13


def test_cstdatetime_cache_ok():
    from src.db.types import CstDateTime
    assert CstDateTime.cache_ok is True
```

- [ ] **Step 2: 跑确认失败** → FAIL（`src.db.types` 不存在）。

- [ ] **Step 3: 实现** — 新建 `src/db/types.py`（按 spec §4.1）：
```python
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator

from src.core.cst import CST


class CstDateTime(TypeDecorator):
    """SQLite 不存时区。本类型把 datetime 列归一到 CST 本地墙上时间存储，
    读出时统一补回 CST tzinfo，使 ORM 层 datetime 恒为 CST-aware。"""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(CST)
        return value.replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=CST) if value.tzinfo is None else value.astimezone(CST)
```

- [ ] **Step 4: 通过 + 全量** → `uv run pytest tests/test_cst_datetime.py -v && uv run pytest -q`。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/db/types.py apps/server/tests/test_cst_datetime.py
git commit -m "feat(db): CstDateTime TypeDecorator——SQLite datetime 读出统一补 CST tzinfo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 修 `workspace_authorized_dir.created_at` server_default（评审揪出的真 bug，**先于换列**）

**Files:** Modify `src/models/workspace_authorized_dir.py`. Test: APPEND `tests/test_cst_datetime.py`.

- [ ] **Step 1: 失败测试**（行往返断言 created_at 为 CST-aware、非 UTC 偏移）
```python
def test_authorized_dir_created_at_is_cst_not_utc(db_session):
    from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir
    from src.core.cst import cst_now
    row = WorkspaceAuthorizedDir(workspace_id=1, path="/x")
    db_session.add(row); db_session.commit(); db_session.expire_all()
    got = db_session.get(WorkspaceAuthorizedDir, row.id)
    assert got.created_at.tzinfo is not None
    # created_at 与 cst_now 同一时刻（容差宽），不得偏 8 小时
    assert abs((cst_now() - got.created_at).total_seconds()) < 300
```
（先 READ `workspace_authorized_dir.py` 确认 `WorkspaceAuthorizedDir` 构造参数；按真实字段调整。）

- [ ] **Step 2: 跑确认失败** → 现 `server_default=func.now()` 写 naive UTC、列尚未 CstDateTime → 偏 8h 或 tzinfo None → FAIL。

- [ ] **Step 3: 实现** — `workspace_authorized_dir.py:20-22`：把 `created_at` 的 `server_default=func.now()` 改为 Python 侧 `default=cst_now`（import `from src.core.cst import cst_now`），并把列类型换成 `CstDateTime`（见 Task 4 统一换；此处先把这一列换上以使测试通过）。若 `func` 不再被引用则删 import。

- [ ] **Step 4: 通过** → `uv run pytest tests/test_cst_datetime.py -v`。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/models/workspace_authorized_dir.py apps/server/tests/test_cst_datetime.py
git commit -m "fix(db): authorized_dir.created_at 改 default=cst_now（避免 server_default func.now() 写 naive UTC 被误标 CST）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 全库 model 列换 `CstDateTime`

**Files:** Modify 所有 `src/models/*.py` 含 `DateTime` 的列。Test: APPEND `tests/test_cst_datetime.py`（集成往返）。

- [ ] **Step 1: 失败/契约测试**（跨 model 抽样：建行→commit→新 session 读→断言 tzinfo==CST 且可与 cst_now() 比较）
```python
def test_db_datetime_columns_read_back_cst_aware(db_session):
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace
    from src.core.cst import CST, cst_now
    from datetime import datetime, timedelta
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    # 写 naive run_at（模拟生产）
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="x", plan_json="[]",
        status="confirmed", schedule_kind="once", run_at=datetime.now() + timedelta(hours=1))
    db_session.add(plan); db_session.commit(); db_session.expire_all()
    got = db_session.get(OrchestrationPlan, plan.id)
    assert got.run_at.tzinfo == CST and got.created_at.tzinfo == CST
    # 关键：与 cst_now() 直接比较不再抛 TypeError
    assert (got.run_at <= cst_now()) in (True, False)
```

- [ ] **Step 2: 跑确认失败** → run_at 仍 naive（列未换）→ `run_at.tzinfo == CST` FAIL。

- [ ] **Step 3: 实现** — 逐文件把 `DateTime(timezone=True)` 替换为 `CstDateTime`（每文件加 `from src.db.types import CstDateTime`）。逐文件改、逐文件 `uv run pytest -q` 不退化。

**评审给出的全量清单（14 文件，全部 `DateTime(timezone=True)`，无裸 DateTime、无 duration-as-DateTime）：**
- `orchestration_plan.py`: run_at, last_run_at, next_run_at, started_at, created_at, updated_at
- `plan_run.py`: started_at, ended_at, created_at
- `task_execution_log.py`: started_at, ended_at, last_heartbeat_at, reported_at, qa_accepted_at, created_at
- `workspace_authorized_dir.py`: created_at — **Task 3 已处理**（含 server_default→default=cst_now、删 unused `func` import）
- `workspace.py`: created_at, updated_at
- `conversation.py`: created_at, updated_at, + 第二个 model 的 created_at
- `skill_rating.py`: created_at
- `employee_skill.py`: created_at, updated_at
- `employee_task.py`: valid_from, valid_until, next_run_at, last_run_at, created_at, updated_at
- `employee.py`: created_at, updated_at
- `performance_record.py`: created_at, updated_at
- `recent_contact.py`: 3 列
- `dispatch_order_sync.py`: 8 列（均 `default=cst_now` Python 侧，无 server_default，安全）
- `config_kv.py`: created_at, updated_at

`func.now()` 全库仅 authorized_dir 一处（Task 3 已修）。`src/models/` 之外无 DateTime 列、无 Table()/关联表。

- [ ] **Step 4: 通过 + 全量** → `uv run pytest tests/test_cst_datetime.py -v && uv run pytest -q`（零新增 failed）。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/models/ apps/server/tests/test_cst_datetime.py
git commit -m "feat(db): 全库 datetime 列换 CstDateTime（读出恒 CST-aware）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: R1 序列化测试（仅 2 个无 serializer 模型 + strftime 批不变）

**Files:** Test: NEW `tests/test_datetime_serialization.py`.

- [ ] **Step 1: 测试**
- READ `src/schemas/orchestration.py:49`（`OrchestrationPlanRead`）、`src/schemas/skill_rating.py:30`、以及一个用 `.strftime()` field_serializer 的模型（如 `src/schemas/task.py`）。
- 写测试：用 ORM 对象（aware created_at）构造这两个无 serializer 模型 → `model.model_dump_json()` / `model_dump(mode="json")` → 断言 datetime 字段含 `+08:00`（确认行为变更已知且稳定）。再对 strftime 批的一个模型断言输出仍是 `YYYY-MM-DD HH:MM:SS`（无偏移、不变）。
- （目的是锁定行为、防回归，不是阻止变更。）

- [ ] **Step 2-4: 跑通**（这些是表征测试，实现已在 Task 4 完成，应直接通过）。

- [ ] **Step 5: Commit**
```bash
git add apps/server/tests/test_datetime_serialization.py
git commit -m "test(schema): 锁定 datetime 序列化——2个无serializer模型带+08:00、strftime批不变

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 清理 4 处旧 `.replace(tzinfo=None)` + 简化 reload_jobs:141

**Files:** Modify `src/service/stream_registry.py`(2445,2585), `src/service/orchestration_lifecycle.py`(179-181), `src/service/task_service.py`(885-887), `src/service/task_scheduler_service.py`(once 分支).

- [ ] **Step 1: 逐处确认操作数现均 aware**
对每处 READ 上下文，确认相减/比较两侧都来自 DB 列（现 CstDateTime → aware）或 `cst_now()`（aware）。无第三方 naive 混入。

- [ ] **Step 2: 改**
- 4 处 `(a.replace(tzinfo=None) - b.replace(tzinfo=None)).total_seconds()` → `(a - b).total_seconds()`（两侧 aware，相减得 timedelta 正常）。
- `task_scheduler_service.py` once 分支：`run_at_aware = plan.run_at.replace(tzinfo=CST) if ...` 简化回 `plan.run_at <= now`（列已 aware）。**保留** per-plan `try/except` 隔离不动。

- [ ] **Step 3: 通过 + 全量**
`uv run pytest tests/test_scheduling_consolidation.py tests/test_scheduled_recurring_orchestration.py -v && uv run pytest -q`。
**特别确认** `test_reload_jobs_once_naive_run_at_does_not_crash`（Task 6 前后均须绿——naive run_at 经列读出已 aware；但该测试直接构造 ORM 对象未必过 DB，需 READ 确认其断言仍成立；若该测试直接 set naive 且不 commit→需调整为 commit 往返或保留 once 分支对 naive 的兜底）。

> ⚠️ 实现者注意：`reload_jobs` 用 `get_session_local()` 自己的 session 读 plan，故 run_at 经 CstDateTime 读出为 aware；但 `test_reload_jobs_once_naive_run_at_does_not_crash` 若在内存库 commit 后由 reload_jobs 的 session 读，也会 aware。确认简化后该回归测试仍绿；若简化导致它失效，**保留** `plan.run_at` 的防御（宁稳不激进），并在测试注释说明。

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/service/stream_registry.py apps/server/src/service/orchestration_lifecycle.py apps/server/src/service/task_service.py apps/server/src/service/task_scheduler_service.py
git commit -m "refactor(time): 清理 4 处 .replace(tzinfo=None) 补丁 + 简化 reload_jobs once（列已 CST-aware）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成标准
- [ ] 全后端 `uv run pytest -q` 零新增 failed（基线 1 预存）。
- [ ] 任意 DB datetime 列读回为 CST-aware，与 `cst_now()` 比较/相减不抛 TypeError。
- [ ] `workspace_authorized_dir.created_at` 不再偏 8 小时。
- [ ] 4 处旧补丁清理、reload_jobs once 简化、per-plan 隔离保留。

## 收尾
- `superpowers:requesting-code-review` 整条 diff 复审（重点：bind/result 正确、authorized_dir default、裸 SQL 不变量、序列化变更范围、4 处清理无逻辑漂移）。
- 手测：重启后端→新建 once 定时任务正常触发；today-task/通知/资源时间显示无回归；授权目录 created_at 时间正确。
- 更新记忆 [[sqlite-naive-datetime-gotcha]]：标注已系统根治。

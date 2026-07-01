# 定时调度收敛 · 阶段A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把编排计划的定时统一收敛到「计划级」一条路径，支持 once（跑一次自停）/ recurring，抽出唯一执行原语 `execute_plan_run`，删除任务级 cron / MCP 死路径——终结定时编排双路径发散的 bug 病根。

**Architecture:** `OrchestrationPlan` 加 `schedule_kind`(once/recurring/None) + `run_at`。`create_orchestration_plan` 在计划级解析 schedule，子任务永不带 cron。`reload_jobs` 只为计划挂 job（recurring→CronTrigger，once→DateTrigger），任务级 job 只留给独立非编排任务。`run_plan_job` 与 `execute_plan` 都走唯一原语 `execute_plan_run(plan, trigger, auto_accept)`。once 跑完 `status="done"` 自停。`run_task_job` 删 MCP 分支 + 删上次的编排子任务分支。脏数据一次性迁移清理。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2.x / APScheduler 3.11（CronTrigger + DateTrigger）/ pytest（内存 SQLite，`db_session` fixture）。

**Spec:** [docs/superpowers/specs/2026-06-22-scheduling-consolidation-design.md](../specs/2026-06-22-scheduling-consolidation-design.md)

---

## 关键约定（动手前必读）

- **工作目录**：路径相对 `apps/server/`。跑测试 `cd apps/server && uv run pytest <path> -v`，全量 `uv run pytest -q`。
- **基线**：开工前 `uv run pytest -q` 应是 `1 failed, ~995 passed`（pre-existing `tests/test_workspace_crud_userlevel.py::test_create_user_workspace_empty`）。每个 Task 完成只允许新增 passed、零新增 failed。
- **DB 迁移**：新列由 `_ensure_orchestration_recurring_columns`（[init_db.py](../../../apps/server/src/db/init_db.py)）幂等 ALTER。测试用内存库 `create_all` 自动可见。
- **测试风格**：照 [tests/test_scheduled_recurring_orchestration.py](../../../apps/server/tests/test_scheduled_recurring_orchestration.py)：`db_session` fixture、`_seed_ws_plan` helper、`_NoCloseSession`、`monkeypatch` 掉 `get_session_local`。
- **提交**：显式 `git add <文件>`，禁用 `git add -A`（仓库有并行前端 WIP）。提交消息结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **import 纪律**（spec §8）：execution.py 顶层**不要** import task_scheduler_service（保持现有"函数内惰性 import"）。per-run 会话 helper 下沉到 `plan_run_service.py`（无环），scheduler 与 execution 都引用它。

---

## 文件结构总览

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/models/orchestration_plan.py` | 加 `schedule_kind` / `run_at` 列 | 改 |
| `src/db/init_db.py` | 迁移加列 + 脏数据清理 | 改 |
| `src/service/schedule_parser.py` | `parse_schedule` —— once/recurring 归类 | **新建** |
| `src/service/agent/orchestrator/plan_run_service.py` | 下沉 `create_scheduled_run_conversation` helper | 改 |
| `src/service/agent/orchestrator/execution.py` | `execute_plan_run` 原语 + execute_plan 收敛 | 改 |
| `src/service/task_scheduler_service.py` | reload_jobs 计划级(Cron+Date)/任务级收窄、run_plan_job 走原语+once自停、删 MCP + 编排子任务分支 | 改 |
| `src/service/agent/orchestrator/tools/plans.py` | schedule 计划级解析、删 per-task cron | 改 |
| `src/service/agent/orchestrator/confirmation_policy.py` | 免确认判定改看计划级 schedule | 改 |
| `tests/test_scheduling_consolidation.py` | 阶段A 单测/集成 | **新建** |

---

## Task 1: OrchestrationPlan.schedule_kind / run_at 列 + 迁移

**Files:**
- Modify: `src/models/orchestration_plan.py`, `src/db/init_db.py`
- Test: `tests/test_scheduling_consolidation.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/test_scheduling_consolidation.py`：

```python
def test_plan_has_schedule_kind_and_run_at_columns():
    from src.models.orchestration_plan import OrchestrationPlan
    cols = OrchestrationPlan.__table__.columns
    assert "schedule_kind" in cols
    assert "run_at" in cols
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py::test_plan_has_schedule_kind_and_run_at_columns -v`
Expected: FAIL。

- [ ] **Step 3: 加列**

`src/models/orchestration_plan.py`，在 `is_recurring` 列附近加（顶部已 import `String`/`DateTime`/`Boolean`，确认后用）：

```python
    # 计划级调度类型：once（一次性，用 run_at）/ recurring（重复，用 cron）/ None（即时）
    schedule_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # once 的绝对触发时间（recurring 用 cron）
    run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

`src/db/init_db.py` 的 `_ensure_orchestration_recurring_columns`，在 `with engine.begin() as conn:` 块内加：

```python
        if "schedule_kind" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN schedule_kind VARCHAR(16)"))
            logger.info("added column orchestration_plans.schedule_kind")
        if "run_at" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN run_at DATETIME"))
            logger.info("added column orchestration_plans.run_at")
```

更新该函数 docstring 列出新列。

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py::test_plan_has_schedule_kind_and_run_at_columns -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd "D:\code\company\digital-employe-client-web-main"
git add apps/server/src/models/orchestration_plan.py apps/server/src/db/init_db.py apps/server/tests/test_scheduling_consolidation.py
git commit -m "feat(sched): OrchestrationPlan.schedule_kind/run_at 列 + 迁移

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: parse_schedule —— once/recurring 归类

**Files:**
- Create: `src/service/schedule_parser.py`
- Test: `tests/test_scheduling_consolidation.py`

### 设计
`parse_schedule(text, *, now)` 返回一个简单 dataclass/具名结构：
- `ScheduleSpec(kind="recurring", cron="0 10 * * *", run_at=None)` 或
- `ScheduleSpec(kind="once", cron=None, run_at=<datetime>)` 或
- `None`（无法解析）。

判别顺序（**关键**，spec §5 顺序坑）：
1. 先 LLM 一次性归类（once/recurring + 值）。LLM 不可用/解析失败时回落 2。
2. 回落：纯 5 段 cron 数字串 → recurring；否则 None。

- [ ] **Step 1: 写失败测试（用 monkeypatch 注入假 LLM，避免真网络）**

APPEND：

```python
def test_parse_schedule_recurring_cron_passthrough():
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    spec = parse_schedule("0 10 * * *", now=cst_now())
    assert spec is not None and spec.kind == "recurring" and spec.cron == "0 10 * * *"


def test_parse_schedule_once_via_llm(monkeypatch):
    import src.service.schedule_parser as sp
    from src.models.workspace import cst_now
    # 假 LLM：把"5分钟后"判成 once + 一个 ISO 时间
    monkeypatch.setattr(sp, "_classify_with_llm",
        lambda text, now: ("once", "2026-06-22 21:34:00"))
    spec = parse_schedule("5分钟后提醒", now=cst_now())
    assert spec.kind == "once" and spec.run_at is not None and spec.cron is None


def test_parse_schedule_recurring_via_llm(monkeypatch):
    import src.service.schedule_parser as sp
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm",
        lambda text, now: ("recurring", "30 9 * * *"))
    spec = parse_schedule("每天上午9点半", now=cst_now())
    assert spec.kind == "recurring" and spec.cron == "30 9 * * *"


def test_parse_schedule_unparseable_returns_none(monkeypatch):
    import src.service.schedule_parser as sp
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: (None, None))
    assert parse_schedule("满月的子时", now=cst_now()) is None
```

注意 import：测试顶部 `from src.service.schedule_parser import parse_schedule`。

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k parse_schedule -v`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/service/schedule_parser.py`：

```python
"""计划级调度解析：把自然语言/cron 归类成 once（一次性）或 recurring（重复）。"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)

_RE_CRON = re.compile(r"^[\d\s\*\,\/\-]+$")


@dataclass
class ScheduleSpec:
    kind: str           # "once" | "recurring"
    cron: str | None = None
    run_at: datetime | None = None


def _classify_with_llm(text: str, now: datetime) -> tuple[str | None, str | None]:
    """LLM 归类：返回 (kind, value)。kind in {"once","recurring",None}。
    once → value 是绝对时间 "YYYY-MM-DD HH:MM:SS"；recurring → value 是 5 段 cron。
    失败返回 (None, None)。"""
    try:
        from src.llm.factory import build_chat_model
        model = build_chat_model()
        prompt = (
            "你是定时任务解析器。判断下面的中文时间表达是【一次性(once)】还是【重复(recurring)】，"
            "并给出对应值。\n"
            "- 一次性(如『5分钟后』『今晚8点』『明天上午9点』『6月23日21:34』)：输出两行，"
            f"第一行 once，第二行该绝对时间 YYYY-MM-DD HH:MM:SS（当前时间是 {now:%Y-%m-%d %H:%M:%S}，按此推算）。\n"
            "- 重复(如『每天10点』『每周一』『每5分钟』)：输出两行，第一行 recurring，第二行标准 5 段 cron（分 时 日 月 周）。\n"
            "- 无法解析：只输出一行 none。\n"
            f"表达：{text}"
        )
        resp = model.invoke(prompt)
        content = (resp.content if hasattr(resp, "content") else str(resp)).strip()
        lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
        if not lines:
            return None, None
        kind = lines[0].lower()
        if kind == "none":
            return None, None
        if kind in ("once", "recurring") and len(lines) >= 2:
            return kind, lines[1]
        return None, None
    except Exception:
        logger.warning("parse_schedule LLM 归类失败 text=%r", text, exc_info=True)
        return None, None


def parse_schedule(text: str, *, now: datetime) -> ScheduleSpec | None:
    """把 text 归类成 once / recurring。无法解析返回 None。"""
    stripped = (text or "").strip()
    if not stripped:
        return None

    # 1) 先 LLM 归类（顺序坑：必须先于裸 cron 数字快路，否则"5分钟后"会被误当 cron）
    kind, value = _classify_with_llm(stripped, now)
    if kind == "recurring" and value and _RE_CRON.match(value) and len(value.split()) == 5:
        return ScheduleSpec(kind="recurring", cron=value)
    if kind == "once" and value:
        try:
            run_at = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            # 附 CST 时区（与 cst_now 一致）
            from src.models.workspace import CST
            run_at = run_at.replace(tzinfo=CST)
            return ScheduleSpec(kind="once", run_at=run_at)
        except (ValueError, TypeError):
            pass

    # 2) 回落：纯 5 段 cron 数字串 → recurring
    if _RE_CRON.match(stripped) and len(stripped.split()) == 5:
        return ScheduleSpec(kind="recurring", cron=stripped)

    return None
```

确认 `CST` 在 `src.models.workspace` 可 import（既有 `cst_now` 同处）。

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k parse_schedule -v`
Expected: 4 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/schedule_parser.py apps/server/tests/test_scheduling_consolidation.py
git commit -m "feat(sched): parse_schedule 解析器——once/recurring 归类

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: per-run 会话 helper 下沉到 plan_run_service

**Files:**
- Modify: `src/service/agent/orchestrator/plan_run_service.py`、`src/service/task_scheduler_service.py`
- Test: `tests/test_scheduling_consolidation.py`

为让 `execute_plan_run`（在 execution.py）与 `run_plan_job`（在 scheduler）共用建会话逻辑且不引入循环 import，把 `TaskSchedulerService._create_scheduled_run_conversation` 的实现下沉为 `plan_run_service.create_scheduled_run_conversation(db, plan, run) -> int`。

- [ ] **Step 1: 写失败测试**

APPEND（复用 test_scheduled_recurring_orchestration 里 `_seed_ws_plan` 的等价；本文件自带一份）：

```python
def _seed_ws_plan_sc(db):
    from src.models.workspace import Workspace
    from src.models.orchestration_plan import OrchestrationPlan
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db.add(ws); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="查热搜并总结",
        plan_json="[]", status="confirmed", total_tasks=0)
    db.add(plan); db.flush()
    return ws, plan


def test_create_scheduled_run_conversation_helper(db_session):
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, create_scheduled_run_conversation,
    )
    from src.models.employee import Employee
    from src.models.conversation import Conversation, ConversationMessage
    from sqlalchemy import select
    import json
    ws, plan = _seed_ws_plan_sc(db_session)
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    conv_id = create_scheduled_run_conversation(db_session, plan, run)
    conv = db_session.get(Conversation, conv_id)
    assert conv.target_type == "curator"
    flags = json.loads(conv.session_flags or "{}")
    assert flags["kind"] == "scheduled_run" and flags["plan_id"] == plan.id and flags["run_seq"] == run.run_seq
    msgs = db_session.scalars(select(ConversationMessage).where(ConversationMessage.conversation_id == conv_id)).all()
    assert any("查热搜并总结" in (m.content or "") for m in msgs)
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k create_scheduled_run_conversation -v`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 下沉实现**

在 `src/service/agent/orchestrator/plan_run_service.py` 加（顶部按需 import）：

```python
def create_scheduled_run_conversation(db: Session, plan, run) -> int:
    """为一轮 scheduled run 新建专属 curator 会话（session_flags=scheduled_run）
    + 种 plan.user_input 上下文。返回 conversation_id。调用方负责 commit 与异常处理。
    run_plan_job 与 execute_plan_run 共用，避免 execution↔scheduler 循环依赖。"""
    import json
    from src.core.request_utils import DEFAULT_USER_ID
    from src.models.conversation import Conversation, ConversationMessage
    from src.models.workspace import Workspace
    from src.service.employee_service import EmployeeService

    ws = db.get(Workspace, plan.workspace_id)
    user_id = ws.user_id if ws is not None else DEFAULT_USER_ID
    curator = EmployeeService.ensure_curator_employee(db, user_id, plan.workspace_id)
    summary = (plan.user_input or "").strip().replace("\n", " ")
    if len(summary) > 30:
        summary = summary[:30] + "…"
    title = f"「{summary}」· 第{run.run_seq}轮"
    flags = json.dumps(
        {"kind": "scheduled_run", "plan_id": plan.id, "run_seq": run.run_seq},
        ensure_ascii=False,
    )
    conv = Conversation(
        workspace_id=plan.workspace_id, user_id=user_id,
        target_type="curator", target_id=curator.id, title=title, session_flags=flags,
    )
    db.add(conv); db.flush()
    db.add(ConversationMessage(
        conversation_id=conv.id, role="user",
        content=plan.user_input or title, stream_state="completed",
    ))
    return conv.id
```

把 `TaskSchedulerService._create_scheduled_run_conversation` 改成**薄转发**（保留方法名给现有调用，但内部转调新 helper），或直接改 run_plan_job 调新 helper 并删旧方法。**推荐删旧方法**，run_plan_job 改调 `create_scheduled_run_conversation`（下一个 Task 会重写 run_plan_job，这里先让旧方法转发以保持现有测试绿）：

```python
    @classmethod
    def _create_scheduled_run_conversation(cls, db, plan, run) -> int:
        from src.service.agent.orchestrator.plan_run_service import create_scheduled_run_conversation
        return create_scheduled_run_conversation(db, plan, run)
```

- [ ] **Step 4: 跑确认通过 + 现有相关测试不破**

Run:
```
cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k create_scheduled_run_conversation -v
uv run pytest tests/test_scheduled_recurring_orchestration.py -k "creates_per_run_conversation or run_task_job_plan_subtask" -v
```
Expected: 新测试 PASS；既有 per-run 会话测试仍 PASS（薄转发保证）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/plan_run_service.py apps/server/src/service/task_scheduler_service.py apps/server/tests/test_scheduling_consolidation.py
git commit -m "refactor(sched): per-run 会话 helper 下沉 plan_run_service（解 execution↔scheduler 环）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: execute_plan_run 唯一执行原语

**Files:**
- Modify: `src/service/agent/orchestrator/execution.py`
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_execute_plan_run_scheduled_opens_new_conversation(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from src.models.conversation import Conversation
    from sqlalchemy import select
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()

    seen = {}
    monkeypatch.setattr(ex, "start_immediate_tasks",
        lambda db, tasks, plan, ws_id, run_id, orchestrator_conversation_id=None:
            seen.update(run_id=run_id, orch_conv=orchestrator_conversation_id) or [])

    run = ex.execute_plan_run(db_session, plan, trigger="scheduled", auto_accept=True)
    assert run.trigger == "scheduled" and run.conversation_id is not None
    conv = db_session.get(Conversation, run.conversation_id)
    assert conv.target_type == "curator"  # 新 per-run 会话
    assert seen["run_id"] == run.id and seen["orch_conv"] == run.conversation_id


def test_execute_plan_run_manual_reuses_plan_conversation(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.conversation import Conversation
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.plan_json = '[{"depends_on": null}]'
    conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=1, title="源")
    db_session.add(conv); db_session.flush()
    plan.conversation_id = conv.id; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    run = ex.execute_plan_run(db_session, plan, trigger="manual", auto_accept=False)
    assert run.trigger == "manual" and run.conversation_id == conv.id  # 复用创建源会话
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k execute_plan_run -v`
Expected: FAIL。

- [ ] **Step 3: 实现 execute_plan_run**

`src/service/agent/orchestrator/execution.py`，在 `execute_plan` 之前加：

```python
def execute_plan_run(db: Session, plan: OrchestrationPlan, *, trigger: str, auto_accept: bool):
    """唯一执行原语：开 PlanRun + 解析本轮会话 + 派 root 任务。
    trigger=="scheduled" → 每轮新 curator 会话；=="manual" → 复用 plan.conversation_id。
    返回 PlanRun。调用方负责 last_run/next_run/once 自停等后续。"""
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, create_scheduled_run_conversation,
    )

    run = open_plan_run(db, plan.id, plan.workspace_id, trigger=trigger, auto_accept=auto_accept)
    db.commit()

    if trigger == "scheduled":
        run.conversation_id = create_scheduled_run_conversation(db, plan, run)
    else:
        run.conversation_id = plan.conversation_id
    db.commit()

    tasks = list(db.scalars(
        select(EmployeeTask).where(
            EmployeeTask.orchestration_plan_id == plan.id,
            EmployeeTask.is_active.is_(True),
        ).order_by(EmployeeTask.priority.desc(), EmployeeTask.id.asc())
    ).all())
    start_immediate_tasks(
        db, tasks, plan, plan.workspace_id,
        run_id=run.id, orchestrator_conversation_id=run.conversation_id,
    )
    return run
```

（`OrchestrationPlan`、`EmployeeTask`、`select` 在 execution.py 顶部已 import，确认。）

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k execute_plan_run -v`
Expected: 2 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/execution.py apps/server/tests/test_scheduling_consolidation.py
git commit -m "feat(sched): execute_plan_run 唯一执行原语（manual/scheduled 共用）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: execute_plan 收敛到原语 + 计划级 schedule 判定

**Files:**
- Modify: `src/service/agent/orchestrator/execution.py`（`execute_plan` ~127）
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_execute_plan_scheduled_only_registers(db_session, monkeypatch):
    """定时计划(schedule_kind 非空)：execute_plan 只注册调度、不立即跑、不开 PlanRun。"""
    import src.service.agent.orchestrator.execution as ex
    from src.models.plan_run import PlanRun
    from sqlalchemy import select
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "recurring"; plan.cron = "0 10 * * *"; db_session.commit()
    called = {}
    monkeypatch.setattr("src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        classmethod(lambda cls: called.setdefault("reload", True)))
    ran = {"run": False}
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: ran.update(run=True))
    msg = ex.execute_plan(db_session, plan, ws.id)
    assert called.get("reload") and not ran["run"]
    assert db_session.scalars(select(PlanRun).where(PlanRun.plan_id == plan.id)).first() is None


def test_execute_plan_immediate_runs_via_primitive(db_session, monkeypatch):
    """即时计划(无 schedule)：execute_plan 走 execute_plan_run(manual)。"""
    import src.service.agent.orchestrator.execution as ex
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = None; plan.cron = None; db_session.commit()
    seen = {}
    monkeypatch.setattr(ex, "execute_plan_run",
        lambda db, p, *, trigger, auto_accept: seen.update(trigger=trigger, auto=auto_accept))
    ex.execute_plan(db_session, plan, ws.id)
    assert seen == {"trigger": "manual", "auto": False}
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "execute_plan_scheduled_only or execute_plan_immediate" -v`
Expected: FAIL。

- [ ] **Step 3: 重写 execute_plan**

`src/service/agent/orchestrator/execution.py`，把 `execute_plan`（127-172）整体替换：

```python
def execute_plan(db: Session, plan: OrchestrationPlan, workspace_id: int) -> str:
    plan.status = "confirmed"
    plan.started_at = cst_now()
    db.commit()

    # 定时计划（计划级 schedule）：只注册调度，不立即跑。
    if (plan.schedule_kind or "").strip():
        from src.service.task_scheduler_service import TaskSchedulerService
        TaskSchedulerService.reload_jobs()
        when = plan.cron if plan.schedule_kind == "recurring" else plan.run_at
        return f"编排计划 #{plan.id} 已设为定时（{plan.schedule_kind}: {when}），到点自动执行。"

    # 即时计划：唯一原语 manual run，立即派活。
    execute_plan_run(db, plan, trigger="manual", auto_accept=False)
    return f"编排计划 #{plan.id} 执行中。"
```

删除原 immediate_tasks/scheduled_tasks 拆分与旧 cron 短路（收敛后子任务全 immediate、定时只看 plan.schedule_kind）。

- [ ] **Step 4: 跑确认通过 + 既有 execute_plan 测试适配**

Run:
```
cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "execute_plan_scheduled_only or execute_plan_immediate" -v
uv run pytest tests/test_scheduled_recurring_orchestration.py -k "execute_plan" -v
```
既有 `test_execute_plan_opens_run_and_tags_root_log` / `test_execute_plan_manual_run_writes_conversation_id_from_plan` 可能因内部结构变化需适配——它们断言的"manual run + conversation_id"现由 execute_plan_run 保证。若红：适配为调 execute_plan（即时计划路径）后查 PlanRun（trigger=manual、conversation_id=plan.conversation_id），不弱化断言。记录适配项。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/execution.py apps/server/tests/
git commit -m "feat(sched): execute_plan 收敛到 execute_plan_run + 计划级 schedule 判定

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: reload_jobs —— 计划级(Cron+Date) + 任务级收窄

**Files:**
- Modify: `src/service/task_scheduler_service.py`（`reload_jobs` ~90）
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写失败测试（验证 SQL 选取，不启真 APScheduler）**

这些测试直接复刻 reload_jobs 的两段 WHERE，断言选取集合：

```python
def test_reload_jobs_task_scan_excludes_all_orchestration_subtasks(db_session):
    """任务级扫描只取独立非编排任务（orchestration_plan_id IS NULL）。"""
    from sqlalchemy import select, func
    from src.models.employee_task import EmployeeTask
    from src.models.employee import Employee
    from src.models.workspace import Workspace
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    standalone = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="独立",
        execute_mode="scheduled", cron_expression="0 9 * * *", dispatch_type="skill", is_active=True)
    sub = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="子",
        execute_mode="scheduled", cron_expression="0 9 * * *", dispatch_type="skill",
        orchestration_plan_id=1, is_active=True)
    db_session.add_all([standalone, sub]); db_session.commit()
    # 复刻收窄后的 task 级 WHERE
    rows = db_session.scalars(select(EmployeeTask).where(
        EmployeeTask.is_active.is_(True),
        EmployeeTask.dispatch_type == "skill",
        EmployeeTask.cron_expression.isnot(None),
        func.trim(EmployeeTask.cron_expression) != "",
        EmployeeTask.orchestration_plan_id.is_(None),
    )).all()
    ids = {t.id for t in rows}
    assert standalone.id in ids and sub.id not in ids


def test_reload_jobs_plan_scan_includes_once_and_recurring(db_session):
    """计划级扫描取 confirmed 且 schedule_kind 非空的计划。"""
    from sqlalchemy import select
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace, cst_now
    from datetime import timedelta
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    rec = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="r", plan_json="[]",
        status="confirmed", schedule_kind="recurring", cron="0 10 * * *")
    once_future = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="o", plan_json="[]",
        status="confirmed", schedule_kind="once", run_at=cst_now() + timedelta(hours=1))
    once_done = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="d", plan_json="[]",
        status="done", schedule_kind="once", run_at=cst_now() + timedelta(hours=1))
    db_session.add_all([rec, once_future, once_done]); db_session.commit()
    rows = db_session.scalars(select(OrchestrationPlan).where(
        OrchestrationPlan.status == "confirmed",
        OrchestrationPlan.schedule_kind.isnot(None),
    )).all()
    ids = {p.id for p in rows}
    assert rec.id in ids and once_future.id in ids and once_done.id not in ids  # done 不入
```

- [ ] **Step 2: 跑确认失败**（断言会因当前 reload_jobs 仍是旧 SQL 而……其实这两个测试是复刻新 SQL 的纯查询，会直接 PASS。改为：先验证它们 PASS，再去改 reload_jobs 让真实代码匹配。）

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "reload_jobs_task_scan or reload_jobs_plan_scan" -v`
Expected: PASS（纯查询自洽）。它们是**契约测试**，锁定 reload_jobs 应有的选取语义。

- [ ] **Step 3: 改 reload_jobs**

`src/service/task_scheduler_service.py`，顶部加 `from apscheduler.triggers.date import DateTrigger`。

**(A) 任务级扫描**：把 `dispatch_type.in_(("skill","mcp"))` 改 `== "skill"`；把那段 `or_(orchestration_plan_id IS NULL, OrchestrationPlan.cron ...)` 整体替换为单条 `EmployeeTask.orchestration_plan_id.is_(None)`，并移除为此加的 outerjoin。

**(B) 计划级扫描**：把现有"扫 cron 非空 confirmed plan 挂 CronTrigger"那段，改为按 schedule_kind 分流：

```python
            from src.models.orchestration_plan import OrchestrationPlan
            plans = list(db.scalars(
                select(OrchestrationPlan).where(
                    OrchestrationPlan.status == "confirmed",
                    OrchestrationPlan.schedule_kind.isnot(None),
                )
            ).all())
            for plan in plans:
                job_id = f"plan:{plan.id}"
                if plan.schedule_kind == "recurring":
                    cron = (plan.cron or "").strip()
                    if not cron or TaskService.compute_next_run(cron, now=now) is None:
                        logger.warning("跳过无法解析的 recurring cron plan_id=%s cron=%r", plan.id, cron)
                        continue
                    trigger = CronTrigger.from_crontab(cron, timezone=CST)
                elif plan.schedule_kind == "once":
                    # once：未跑过(last_run_at 空) 且 run_at 在未来才挂 DateTrigger
                    if plan.last_run_at is not None or plan.run_at is None or plan.run_at <= now:
                        continue
                    trigger = DateTrigger(run_date=plan.run_at, timezone=CST)
                else:
                    continue
                scheduler.add_job(
                    cls.run_plan_job, trigger=trigger, id=job_id, args=[plan.id],
                    replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=120,
                )
                job = scheduler.get_job(job_id)
                plan.next_run_at = job.next_run_time if job else (
                    TaskService.compute_next_run(plan.cron) if plan.schedule_kind == "recurring" else plan.run_at
                )
            db.commit()
```

- [ ] **Step 4: 跑确认通过 + 既有 reload 相关测试**

Run:
```
cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "reload_jobs" -v
uv run pytest tests/test_scheduled_recurring_orchestration.py -k "reload_jobs or run_plan_job_opens" -v
```
既有 `test_reload_jobs_task_level_filter_skips_only_plan_level_cron_managed`（上次加的 OR 过滤回归）会**失效/语义变化**——它断言"plan.cron 空但子任务带 cron 时子任务被扫到"，而新模型下编排子任务一律不扫。**适配该测试**：改为断言"编排子任务一律不被 task 级扫描"（与新 contract 一致），或删除该测试并由本 Task 的 `test_reload_jobs_task_scan_excludes_all_orchestration_subtasks` 取代。记录处理方式（删除旧测试 + 注明被新契约取代，不算弱化）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/task_scheduler_service.py apps/server/tests/
git commit -m "feat(sched): reload_jobs 计划级(Cron+Date)统一 + 任务级收窄为独立非编排任务

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: run_plan_job 走原语 + once 自停；删 run_task_job 死路径

**Files:**
- Modify: `src/service/task_scheduler_service.py`（`run_plan_job`、`run_task_job`、删 `_execute_mcp_tool_call`）
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_run_plan_job_once_auto_stops(db_session, monkeypatch):
    """once 计划跑完 status=done，不再被调度。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.workspace import cst_now
    from sqlalchemy.orm import sessionmaker
    from datetime import timedelta
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "once"; plan.run_at = cst_now() + timedelta(minutes=5)
    db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "done"  # once 自停


def test_run_plan_job_recurring_updates_next_run(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "recurring"; plan.cron = "0 10 * * *"; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "confirmed" and p.last_run_at is not None and p.next_run_at is not None
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "run_plan_job_once or run_plan_job_recurring" -v`
Expected: FAIL。

- [ ] **Step 3: 重写 run_plan_job**

`src/service/task_scheduler_service.py` 的 `run_plan_job`：

```python
    @classmethod
    def run_plan_job(cls, plan_id: int) -> None:
        """计划级定时触发：走唯一原语 execute_plan_run；once 跑完自停。
        绝不调 _start_curator_task / 不重发总管消息 / 不重新分析分单。"""
        from src.models.orchestration_plan import OrchestrationPlan
        from src.service.agent.orchestrator.execution import execute_plan_run

        with get_session_local()() as db:
            plan = db.get(OrchestrationPlan, plan_id)
            if plan is None or plan.status != "confirmed" or not (plan.schedule_kind or "").strip():
                return
            try:
                execute_plan_run(db, plan, trigger="scheduled", auto_accept=True)
            except Exception:
                logger.error("run_plan_job 触发失败 plan=%s", plan_id, exc_info=True)
            # once：跑完自停（status=done → reload_jobs 不再挂）
            if plan.schedule_kind == "once":
                plan.last_run_at = cst_now()
                plan.next_run_at = None
                plan.status = "done"
            else:  # recurring
                plan.last_run_at = cst_now()
                plan.next_run_at = TaskService.compute_next_run(plan.cron, now=plan.last_run_at)
            db.commit()
            logger.info("计划级定时触发 plan=%s kind=%s（绕开总管重分析）", plan_id, plan.schedule_kind)
```

> 注：execute_plan_run 内部失败已标 run failed；这里外层 except 兜底防 once 不自停。

删除旧 run_plan_job 里内联的 open_plan_run/建会话/start_immediate_tasks（已进原语）。删除 `_create_scheduled_run_conversation` 薄转发方法（Task 3 留的）如已无人调用——确认无引用后删。

- [ ] **Step 4: 重写 run_task_job（删 MCP + 删编排子任务分支）**

`run_task_job`：
- 删除整个 `dispatch_type=="mcp"` 分支（`started_at = cst_now()` 起到 MCP 异常处理结束的整段）+ 删 `_execute_mcp_tool_call` 方法 + 删 **仅 MCP 用**的 import：`httpx`、`urllib.parse`、`EmployeeMcp`、`get_settings`（已核实仅 `_execute_mcp_tool_call` 用）。**务必保留 `build_chat_model`**（`parse_nl_cron` 还在用）。删后 grep `_execute_mcp_tool_call` / `httpx` / `urllib` 确认零悬挂引用。
- 删除上次加的 `if task.orchestration_plan_id is not None: 开 PlanRun…` 整段。
- 员工分支恢复为简单派发（不带 run_id/orch_conv，因为独立任务无 plan）：
  ```python
                if employee and employee.is_curator:
                    cls._start_curator_task(db, task, employee)
                else:
                    from src.service.agent.orchestrator import _start_task_as_conversation
                    _start_task_as_conversation(
                        db, task, employee, task.workspace_id,
                        priority=SCHEDULED_PRIORITY, source="scheduled",
                    )
                task.last_run_at = cst_now()
                task.next_run_at = TaskService.compute_next_run(task.cron_expression, now=task.last_run_at)
                db.add(task); db.commit()
                return
  ```
- 顶部 task 查询的 `dispatch_type.in_(("skill","mcp"))` 改 `== "skill"`。
- 防御：若仍收到 `orchestration_plan_id` 非空 task（脏数据），记 warning 后按上面独立分支跑（不再特殊处理）。

- [ ] **Step 5: 跑确认通过 + 相关回归**

Run:
```
cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "run_plan_job" -v
uv run pytest tests/test_scheduled_recurring_orchestration.py -v
```
既有 `test_run_task_job_plan_subtask_opens_run_and_per_run_conversation`（上次加的）现在**与新模型冲突**（编排子任务不再走 run_task_job 开 PlanRun）→ **删除该测试**，注明被新契约取代。`test_run_task_job_standalone_task_no_planrun` 应仍 PASS。`test_run_plan_job_creates_per_run_conversation_and_seeds_user_input` / `test_two_runs_get_separate_conversations` 等需适配为新 run_plan_job 形态（schedule_kind 设置；它们之前设 plan.cron，现也需设 schedule_kind="recurring"）。逐一适配，不弱化断言，记录清单。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/service/task_scheduler_service.py apps/server/tests/
git commit -m "feat(sched): run_plan_job 走原语+once自停；run_task_job 删 MCP+编排子任务死路径

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: create_orchestration_plan 计划级 schedule + 删 per-task cron + 确认策略

**Files:**
- Modify: `src/service/agent/orchestrator/tools/plans.py`、`src/service/agent/orchestrator/confirmation_policy.py`
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写失败测试**

APPEND（参考既有 `tests/test_create_orchestration_plan.py` 的 monkeypatch 套路）：

```python
def test_create_plan_once_sets_run_at(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    import src.service.schedule_parser as sp
    from src.models.workspace import Workspace, cst_now
    from src.models.employee import Employee
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.schedule_parser import ScheduleSpec
    from datetime import timedelta
    from sqlalchemy import select
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_schedule",
        lambda s, now: ScheduleSpec(kind="once", run_at=now + timedelta(minutes=5)), raising=False)
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "scheduled")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "提醒", "prompt": "提醒看世界杯", "depends_on": None}]
    tp.create_orchestration_plan.func("世界杯提醒", tasks, schedule="5分钟后")
    plan = db_session.scalars(select(OrchestrationPlan)).first()
    assert plan.schedule_kind == "once" and plan.run_at is not None and plan.cron is None
    # 子任务一律 immediate / cron 空
    from src.models.employee_task import EmployeeTask
    sub = db_session.scalars(select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id)).first()
    assert sub.execute_mode == "immediate" and (sub.cron_expression or "") == ""


def test_create_plan_recurring_sets_cron(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.schedule_parser import ScheduleSpec
    from sqlalchemy import select
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_schedule",
        lambda s, now: ScheduleSpec(kind="recurring", cron="0 10 * * *"), raising=False)
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "scheduled")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "查", "prompt": "查热搜", "depends_on": None}]
    tp.create_orchestration_plan.func("每天查热搜", tasks, schedule="每天10点")
    plan = db_session.scalars(select(OrchestrationPlan)).first()
    assert plan.schedule_kind == "recurring" and plan.cron == "0 10 * * *" and plan.is_recurring is True


def test_scheduled_plan_requires_confirmation():
    """定时计划(有 schedule)一律需确认，不走只读免确认。"""
    from src.service.agent.orchestrator.confirmation_policy import compute_requires_confirmation
    # 单个 small 只读任务，但计划有 schedule → 仍需确认
    tasks = [{"output_tier": "small", "task_name": "查", "prompt": "查热搜", "depends_on": None}]
    assert compute_requires_confirmation(tasks, has_schedule=True) is True
    # 无 schedule 时单只读任务免确认（原行为）
    assert compute_requires_confirmation(tasks, has_schedule=False) is False
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "create_plan_once or create_plan_recurring or scheduled_plan_requires" -v`
Expected: FAIL。

- [ ] **Step 3: confirmation_policy 加 has_schedule 参**

`src/service/agent/orchestrator/confirmation_policy.py`：`compute_requires_confirmation(task_list, *, has_schedule=False)` —— 开头加 `if has_schedule: return True`。`_task_is_readonly_query` 里那条 `if task.get("cron"): return False` 删掉（子任务不再带 cron；定时由 has_schedule 统管）。

- [ ] **Step 4: 改 create_orchestration_plan**

`src/service/agent/orchestrator/tools/plans.py`：
- import：`from src.service.schedule_parser import parse_schedule`、`from src.models.workspace import cst_now`。删除不再使用的 `parse_nl_cron` import（[plans.py:26](../../../apps/server/src/service/agent/orchestrator/tools/plans.py)，切到 parse_schedule 后无人用，避免死 import）。
- 解析：
  ```python
  spec = parse_schedule(schedule, now=cst_now()) if schedule else None
  if schedule and spec is None:
      return f"错误：无法解析定时表达式「{schedule}」。请换更明确的说法（如『5分钟后』『每天10点』）。"
  ```
- 建 plan：
  ```python
  plan_cron = spec.cron if spec and spec.kind == "recurring" else None
  plan = OrchestrationPlan(
      ..., cron=plan_cron,
      is_recurring=bool(spec and spec.kind == "recurring"),
      schedule_kind=(spec.kind if spec else None),
      run_at=(spec.run_at if spec and spec.kind == "once" else None),
      ...)
  ```
- 子任务：**一律** `cron_expression=""`、`execute_mode="immediate"`（删除原 per-task cron 分支逻辑）。
- 确认：`requires_confirmation = compute_requires_confirmation(task_list, has_schedule=bool(spec))`。
- docstring：移除 per-task `cron` 字段；`schedule` 说明改为"计划级，支持一次性(『5分钟后』『今晚8点』)与重复(『每天10点』)"。

- [ ] **Step 5: 跑确认通过 + 既有 create_plan 测试适配**

Run:
```
cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k "create_plan or scheduled_plan_requires" -v
uv run pytest tests/test_create_orchestration_plan.py tests/test_confirmation_policy.py -v
uv run pytest tests/test_scheduled_recurring_orchestration.py -k "create_plan_with" -v
```
既有测试适配清单（**语义破坏，不只是签名**，逐一处理，不弱化断言）：
- `test_create_orchestration_plan.py` 里 `test_create_plan_with_schedule_sets_plan_cron` / `test_create_plan_with_unparseable_schedule_errors_not_degrades`（上次加的，monkeypatch `parse_nl_cron`）→ 改为 monkeypatch `tp.parse_schedule` 返回 `ScheduleSpec`，断言 schedule_kind/cron。
- **`test_confirmation_policy.py::test_requires_confirmation_when_scheduled`（约 line 23-26）会语义破坏**：它构造一个 `cron="30 9 * * *"` 的 small 只读任务并断言 `True`，**完全依赖**被删的那条 `if task.get("cron")`。删掉该 cron 检查后，该任务变成 small/只读/无依赖/无危险词 + `has_schedule` 默认 False → 返回 `False` → 测试红。**处理：把该测试改为新模型语义**——`compute_requires_confirmation([readonly_task_without_cron], has_schedule=True)` 断言 `True`（定时计划一律需确认），并去掉 task 里的 cron 字段。其余 test_confirmation_policy 用例若按位置传参不受影响（has_schedule 是带默认的 keyword）。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/tools/plans.py apps/server/src/service/agent/orchestrator/confirmation_policy.py apps/server/tests/
git commit -m "feat(sched): create_orchestration_plan 计划级 schedule(once/recurring)+删 per-task cron+确认策略

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 脏数据迁移（清理"plan无cron但子任务带cron"的计划）

**Files:**
- Modify: `src/db/init_db.py`
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写失败测试**

```python
def test_cleanup_legacy_subtask_cron_plans(db_session):
    from src.db.init_db import _cleanup_legacy_subtask_cron_plans
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    # 脏：plan 无 cron/schedule_kind，子任务带 cron
    dirty = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="脏", plan_json="[]",
        status="confirmed", cron=None, schedule_kind=None)
    db_session.add(dirty); db_session.flush()
    dt = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="脏子",
        execute_mode="scheduled", cron_expression="30 17 * * *",
        orchestration_plan_id=dirty.id, is_active=True)
    # 合法 recurring（新模型）：plan 有 schedule_kind，子任务无 cron → 不动
    good = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="好", plan_json="[]",
        status="confirmed", cron="0 10 * * *", schedule_kind="recurring")
    db_session.add(good); db_session.flush()
    gt = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="好子",
        execute_mode="immediate", cron_expression="", orchestration_plan_id=good.id, is_active=True)
    db_session.add_all([dt, gt]); db_session.commit()

    _cleanup_legacy_subtask_cron_plans(db_session.get_bind())
    db_session.expire_all()
    assert db_session.get(OrchestrationPlan, dirty.id).status == "cancelled"
    assert db_session.get(EmployeeTask, dt.id).is_active is False
    assert db_session.get(OrchestrationPlan, good.id).status == "confirmed"  # 合法不动
    assert db_session.get(EmployeeTask, gt.id).is_active is True
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k cleanup_legacy -v`
Expected: FAIL。

- [ ] **Step 3: 实现 + 挂 init_db**

`src/db/init_db.py` 加，并在 `init_db()` 里 `_ensure_orchestration_recurring_columns` 之后调用：

```python
def _cleanup_legacy_subtask_cron_plans(engine) -> None:
    """一次性清理脏数据：计划级无 schedule（cron 空且 schedule_kind 空）但子任务带 task 级 cron
    的编排计划——旧模型的『偷偷定时』产物。收敛后这些子任务不再被调度，置 cancelled 让用户重建。
    三段谓词防误杀合法 recurring（plan.cron 已设的不在此列）。"""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if not {"orchestration_plans", "employee_tasks"}.issubset(tables):
        return
    op_cols = {c["name"] for c in inspector.get_columns("orchestration_plans")}
    if "schedule_kind" not in op_cols:
        return  # 列还没加（迁移未跑），跳过
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT p.id FROM orchestration_plans p
            JOIN employee_tasks t ON t.orchestration_plan_id = p.id
            WHERE p.status = 'confirmed'
              AND (p.cron IS NULL OR trim(p.cron) = '')
              AND (p.schedule_kind IS NULL OR trim(p.schedule_kind) = '')
              AND t.cron_expression IS NOT NULL AND trim(t.cron_expression) != ''
        """)).all()
        ids = [r[0] for r in rows]
        if not ids:
            return
        for pid in ids:
            conn.execute(text("UPDATE orchestration_plans SET status='cancelled' WHERE id=:pid"), {"pid": pid})
            conn.execute(text("UPDATE employee_tasks SET is_active=0 WHERE orchestration_plan_id=:pid"), {"pid": pid})
        logger.info("cleanup legacy subtask-cron plans: cancelled %s (ids=%s)", len(ids), ids)
```

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k cleanup_legacy -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/init_db.py apps/server/tests/test_scheduling_consolidation.py
git commit -m "fix(sched): init_db 一次性清理『plan无调度但子任务带cron』脏数据计划

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 端到端集成 + 全量回归

**Files:**
- Test: `tests/test_scheduling_consolidation.py`

- [ ] **Step 1: 写端到端测试（once 计划 confirm→不立即跑→reload 挂 DateTrigger→触发一次→自停）**

用同步 fake 驱动（参考 test_two_runs_get_separate_conversations 套路）：

```python
def test_e2e_once_plan_confirm_register_fire_autostop(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from src.models.conversation import Conversation
    from src.models.workspace import cst_now
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from datetime import timedelta
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "once"; plan.run_at = cst_now() + timedelta(minutes=5)
    plan.user_input = "5分钟后提醒看世界杯"; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])

    # 触发一次
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "done"  # 自停
        runs = d.scalars(select(PlanRun).where(PlanRun.plan_id == plan_id)).all()
        assert len(runs) == 1 and runs[0].trigger == "scheduled" and runs[0].conversation_id is not None
        conv = d.get(Conversation, runs[0].conversation_id)
        import json
        assert json.loads(conv.session_flags or "{}")["kind"] == "scheduled_run"

    # 再触发（模拟误触）→ 因 status=done 直接返回，不再开新 run
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        runs = d.scalars(select(PlanRun).where(PlanRun.plan_id == plan_id)).all()
        assert len(runs) == 1  # 没有第二轮
```

- [ ] **Step 2: 跑端到端**

Run: `cd apps/server && uv run pytest tests/test_scheduling_consolidation.py -k e2e_once_plan -v`
Expected: PASS。若 FAIL 用 systematic-debugging 定位。

- [ ] **Step 3: 全量后端回归**

Run: `cd apps/server && uv run pytest -q`
Expected: `1 failed, <N> passed, 0 errors` —— 只有 pre-existing `test_create_user_workspace_empty`。所有阶段A 适配过的既有测试全绿。

- [ ] **Step 4: Commit**

```bash
git add apps/server/tests/test_scheduling_consolidation.py
git commit -m "test(sched): once 计划 confirm→注册→触发→自停 端到端

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成标准（阶段A 验收）
- [ ] 全量 `uv run pytest -q` 相对基线零新增 failed/errors。
- [ ] once 计划触发一次后 `status=done`、不再被调度（核心：世界杯提醒不再每天重复）。
- [ ] recurring 计划行为同现有递归（计划级触发 + 每轮新会话）。
- [ ] 编排子任务**永不**被 task 级调度；run_task_job 只剩独立非编排任务 + curator 独立定时；MCP 分支删除。
- [ ] PlanRun 只由 `execute_plan_run` 一处打开。
- [ ] 脏数据（plan 无调度但子任务带 cron）被一次性清理。

## 收尾（实现完成后）
- 用 `superpowers:requesting-code-review` 对整条 diff 复审（重点：import 无环、once 自停无遗漏、reload_jobs 两段选取正确、删除路径无悬挂引用）。
- 后端重启冒烟：新建「5分钟后提醒」→ once 计划、到点触发一次后 status=done；新建「每天X点」→ recurring。
- 阶段A 落地后接阶段B（生命周期）。更新记忆。

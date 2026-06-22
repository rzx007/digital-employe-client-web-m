# 定时递归编排（冻结 DAG + run_id 按轮重跑）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让总管的多步编排计划能"创建时冻结流程、定时按轮重跑"，根治多步定时任务因全历史去重导致的卡死，且触发时不再让总管重新分析分单。

**Architecture:** 引入 `PlanRun`（一轮执行实例），给 `TaskExecutionLog` 加 `run_id`，把 `dependency_scheduler` 的去重/依赖判断从"扫该 task 全历史"收敛为"只看本轮 run"。调度器为递归计划挂**计划级** APScheduler job → 新 `run_plan_job` 开新 run、直接重跑冻结 DAG 根任务（绕开总管重分析）。定时（无人值守）轮 `auto_accept=True`，员工任务一 success 即在 finalize 自动盖 `qa_accepted_at`，复用现成派发闸自动衔接下游。交互式 confirm / 返工统一纳入 run 体系。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2.x / APScheduler / pytest（内存 SQLite，`db_session` fixture）。

**Spec:** [docs/superpowers/specs/2026-06-22-scheduled-recurring-orchestration-design.md](../specs/2026-06-22-scheduled-recurring-orchestration-design.md)

---

## 关键约定（动手前必读）

- **工作目录**：所有路径相对 `apps/server/`；测试命令在 `apps/server/` 下跑。
- **跑测试**：`cd apps/server && uv run pytest tests/<file>::<test> -v`。全量：`uv run pytest -q`。
- **基线**：开工前先 `uv run pytest -q` 记下 `N passed / M failed`（仓库有少量预存 GBK/runtime 基线失败）。每个 Task 完成后只允许新增 passed、零新增 failed。
- **不兼容旧数据**（用户拍板）：`run_id` 在 schema 上 `nullable=True`（容纳非编排日志），但**编排读写路径一律带 run_id**，绝不写"run_id 为空就回落全历史"的分支。
- **DB 迁移**：开发库干净起步，新表/新列由 `Base.metadata.create_all`（[src/db/init_db.py:15](../../../apps/server/src/db/init_db.py)）在干净库自动建出。测试用内存库（conftest 的 `db_engine` 也 `create_all`），故模型加列即测试可见，无需手写 ALTER。
- **测试风格**：照 [tests/test_orchestrator_dag_gating.py](../../../apps/server/tests/test_orchestrator_dag_gating.py) ——`db_session` fixture、`Workspace`/`Employee` 直接 seed、`_NoCloseSession` 代理屏蔽 `close()`、`monkeypatch` 掉 `get_session_local` / `on_employee_task_completed`。
- 提交粒度：每个 Task 一个或多个 commit，`feat:` / `test:` 前缀，结尾带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## 文件结构总览

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/models/plan_run.py` | PlanRun 模型（一轮执行实例） | **新建** |
| `src/models/__init__.py` | 注册 PlanRun 让 metadata 建表 | 改 |
| `src/models/task_execution_log.py` | 加 `run_id` 列 | 改 |
| `src/models/orchestration_plan.py` | 加 `cron`/`is_recurring`/`last_run_at`/`next_run_at` | 改 |
| `src/service/agent/orchestrator/plan_run_service.py` | 开/收尾 PlanRun + 推导"task 当前 run_id"/"plan 最新 run" 的 helper | **新建** |
| `src/service/agent/orchestrator/dependency_scheduler.py` | 全读查询 + 入口 + 返工/只读函数按 run 收敛 | 改 |
| `src/service/agent/orchestrator/execution.py` | execute_plan 开 run、透传 run_id | 改 |
| `src/service/agent/orchestrator/rework.py` | 返工新日志继承 run_id | 改 |
| `src/service/stream_registry.py` | finalize 处 auto_accept 自动盖 qa_accepted_at | 改 |
| `src/service/task_scheduler_service.py` | reload_jobs 计划级 job + run_plan_job | 改 |
| `src/service/agent/orchestrator/tools/plans.py` | 计划级 `schedule` 参数 + 递归只调度不即跑 | 改 |
| `tests/test_scheduled_recurring_orchestration.py` | 本特性单测/集成 | **新建** |

---

## Task 1: 数据模型（PlanRun + run_id + plan 节拍列）

**Files:**
- Create: `src/models/plan_run.py`
- Modify: `src/models/__init__.py`, `src/models/task_execution_log.py:36`（reported_at 附近）, `src/models/orchestration_plan.py:30`（total_tasks 附近）
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（schema 存在性）**

新建 `tests/test_scheduled_recurring_orchestration.py`：

```python
from src.models.task_execution_log import TaskExecutionLog
from src.models.orchestration_plan import OrchestrationPlan


def test_execution_log_has_run_id_column():
    assert "run_id" in TaskExecutionLog.__table__.columns


def test_plan_has_cron_and_recurring_columns():
    cols = OrchestrationPlan.__table__.columns
    for name in ("cron", "is_recurring", "last_run_at", "next_run_at"):
        assert name in cols, name


def test_plan_run_table_exists():
    from src.models.plan_run import PlanRun
    for name in ("plan_id", "run_seq", "trigger", "auto_accept", "status"):
        assert name in PlanRun.__table__.columns, name
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -v`
Expected: FAIL（`ModuleNotFoundError: plan_run` / `run_id` 不在列里）。

- [ ] **Step 3: 建 PlanRun 模型**

`src/models/plan_run.py`：

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class PlanRun(Base):
    """一轮"执行某张编排计划"的实例。

    交互式 confirm / 定时到点 / （返工沿用所在 run）都对应一条 PlanRun。
    去重/依赖判断按 run_id 收敛，根治"全历史去重"导致定时重跑卡死。
    """

    __tablename__ = "plan_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("orchestration_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # manual（confirm）/ scheduled（cron 到点）；返工不新开 run，沿用所在 run。
    trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="manual", index=True)
    # True → 下游免人工 QA 自动放行（无人值守定时轮）。
    auto_accept: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # running / settled
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running", index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
```

- [ ] **Step 4: 注册模型 + 加列**

在 `src/models/__init__.py` 加入 `from src.models.plan_run import PlanRun  # noqa`（与其它模型同样的注册写法；若该文件是 `__all__` 列表也补上）。

`src/models/task_execution_log.py`，在 `reported_at` 列定义之后加：

```python
    # 所属执行轮（PlanRun.id）；编排日志一律写值，非编排（独立 run_task_job）日志为 NULL。
    run_id: Mapped[int | None] = mapped_column(
        ForeignKey("plan_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
```

`src/models/orchestration_plan.py`，在 `total_tasks` 之后加：

```python
    # 计划级节拍（标准 5 段 cron）；非空=递归计划，冻结模板的一部分。
    cron: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
```

> 注意 `orchestration_plan.py` 顶部 import 需含 `Boolean`（当前只 import 了 `DateTime, ForeignKey, Integer, String, Text`——补 `Boolean`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -v`
Expected: 3 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/models/plan_run.py src/models/__init__.py src/models/task_execution_log.py src/models/orchestration_plan.py tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): PlanRun 模型 + TaskExecutionLog.run_id + 计划级节拍列"
```

---

## Task 2: PlanRun 服务 helper（开 run / 收尾 / 推导 run_id）

**Files:**
- Create: `src/service/agent/orchestrator/plan_run_service.py`
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试**

追加到测试文件（顶部已 import 的基础上）：

```python
from src.models.employee import Employee
from src.models.workspace import Workspace
from src.models.orchestration_plan import OrchestrationPlan
from src.models.plan_run import PlanRun


def _seed_ws_plan(db):
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id, conversation_id=1, user_input="x",
        plan_json="[]", status="confirmed", total_tasks=0,
    )
    db.add(plan); db.flush()
    return ws, plan


def test_open_plan_run_increments_run_seq(db_session):
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    ws, plan = _seed_ws_plan(db_session)
    r1 = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    r2 = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    assert r1.run_seq == 1 and r2.run_seq == 2
    assert r2.trigger == "scheduled" and r2.auto_accept is True
    assert r2.status == "running"


def test_latest_run_id_for_task(db_session):
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, latest_run_id_for_task,
    )
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    log = TaskExecutionLog(
        task_id=77, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="success", run_result="r",
        input_json="{}", output_json="{}", started_at=cst_now(), run_id=run.id,
    )
    db_session.add(log); db_session.commit()
    assert latest_run_id_for_task(db_session, 77) == run.id
    assert latest_run_id_for_task(db_session, 999) is None
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k "open_plan_run or latest_run_id" -v`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 plan_run_service**

`src/service/agent/orchestrator/plan_run_service.py`：

```python
"""PlanRun（一轮执行实例）的开启/收尾与 run_id 推导 helper。"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.plan_run import PlanRun
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now


def open_plan_run(
    db: Session, plan_id: int, workspace_id: int, *, trigger: str, auto_accept: bool
) -> PlanRun:
    """为某计划开一轮新 run（run_seq = 现有 max + 1）。调用方负责 commit。"""
    max_seq = db.scalar(
        select(func.max(PlanRun.run_seq)).where(PlanRun.plan_id == plan_id)
    ) or 0
    run = PlanRun(
        plan_id=plan_id,
        workspace_id=workspace_id,
        run_seq=max_seq + 1,
        trigger=trigger,
        auto_accept=auto_accept,
        status="running",
    )
    db.add(run)
    db.flush()
    return run


def latest_run_id_for_task(db: Session, task_id: int) -> int | None:
    """取某 task 最新一条执行日志的 run_id（=该 task 当前所在轮）。无日志/非编排 → None。"""
    return db.scalar(
        select(TaskExecutionLog.run_id)
        .where(TaskExecutionLog.task_id == task_id)
        .order_by(TaskExecutionLog.id.desc())
        .limit(1)
    )


def latest_run_id_for_plan(db: Session, plan_id: int) -> int | None:
    """取某计划最新一轮 run 的 id（按 run_seq）。无 run → None。"""
    return db.scalar(
        select(PlanRun.id)
        .where(PlanRun.plan_id == plan_id)
        .order_by(PlanRun.run_seq.desc())
        .limit(1)
    )


def settle_plan_run(db: Session, run_id: int) -> None:
    """标记一轮 run 全部定局。调用方负责 commit。"""
    run = db.get(PlanRun, run_id)
    if run is not None and run.status != "settled":
        run.status = "settled"
        run.ended_at = cst_now()
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k "open_plan_run or latest_run_id" -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/orchestrator/plan_run_service.py tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): plan_run_service——开/收尾 run + 推导 task/plan 当前 run_id"
```

---

## Task 3: 去重/依赖读查询按 run 收敛（dependency_scheduler 纯函数层）

**Files:**
- Modify: `src/service/agent/orchestrator/dependency_scheduler.py:126`（`_log_status_by_task`）、`:145`（`_load_accepted_task_ids`）、`:324`（`_collect_prereq_artifacts`）、`:300`（`_record_skip`）
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（run 隔离）**

```python
def test_log_status_by_task_scoped_by_run(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import _log_status_by_task
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    r1 = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    r2 = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)

    def _log(task_id, run_id, status):
        db_session.add(TaskExecutionLog(
            task_id=task_id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status=status, run_result="r",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id))
    _log(10, r1.id, "success")   # 上一轮
    _log(10, r2.id, "running")   # 本轮
    db_session.commit()

    # 只看本轮 r2：task10 是 running，不含上一轮的 success
    got = _log_status_by_task(db_session, [10], r2.id)
    assert got == {10: {"running"}}
    # 看 r1：只有 success
    assert _log_status_by_task(db_session, [10], r1.id) == {10: {"success"}}
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k log_status_by_task_scoped -v`
Expected: FAIL（`_log_status_by_task` 还没 run_id 形参 → TypeError）。

- [ ] **Step 3: 给读查询加 run_id 形参**

`_log_status_by_task`（:126）改签名与查询：

```python
def _log_status_by_task(db: Session, task_ids: list[int], run_id: int) -> dict[int, set[str]]:
    """聚合每个任务在**本轮 run** 内的执行日志状态集合。"""
    from src.models.task_execution_log import TaskExecutionLog

    if not task_ids:
        return {}
    rows = db.execute(
        select(TaskExecutionLog.task_id, TaskExecutionLog.run_status).where(
            TaskExecutionLog.task_id.in_(task_ids),
            TaskExecutionLog.run_id == run_id,
        )
    ).all()
    out: dict[int, set[str]] = {}
    for task_id, run_status in rows:
        if task_id is None:
            continue
        out.setdefault(int(task_id), set()).add(run_status or "")
    return out
```

`_load_accepted_task_ids`（:145）加 `run_id` 形参 + `AND run_id == run_id`：

```python
def _load_accepted_task_ids(db: Session, task_ids: list[int], run_id: int) -> set[int]:
    from src.models.task_execution_log import TaskExecutionLog
    if not task_ids:
        return set()
    rows = db.execute(
        select(TaskExecutionLog.task_id)
        .where(
            TaskExecutionLog.task_id.in_(task_ids),
            TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
            TaskExecutionLog.qa_accepted_at.is_not(None),
            TaskExecutionLog.run_id == run_id,
        )
        .distinct()
    ).all()
    return {r[0] for r in rows}
```

`_collect_prereq_artifacts`（:324）加 `run_id` 形参，两处 `select(...).where(...)` 各加 `TaskExecutionLog.run_id == run_id`（取本轮前置产物，不串上一轮）。签名改为 `def _collect_prereq_artifacts(db, dep_ids, run_id):`。

`_record_skip`（:300）加 `run_id` 形参，建 `TaskExecutionLog(...)` 时加 `run_id=run_id`。签名 `def _record_skip(db, task, workspace_id, reason, run_id):`。

> 注：此 Step 会让 `on_employee_task_completed` / `waiting_status_for_task` / `task_prereqs_accepted` 等**调用点暂时报错**（少传 run_id）——它们在 Task 4/5 修。本 Task 只验证纯函数层 + 这一条新测试；**先不要**跑全量。

- [ ] **Step 4: 跑新测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k log_status_by_task_scoped -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/orchestrator/dependency_scheduler.py tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): 去重/接受/产物/skip 读查询按 run_id 收敛"
```

---

## Task 4: 入口推导 run_id + on_employee_task_completed 按轮评估 + 收尾 run

**Files:**
- Modify: `src/service/agent/orchestrator/dependency_scheduler.py:393`（`on_employee_task_completed`）、`:546`（`release_accepted_downstream`）、`:602`（`_dispatch_successor`）
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（重跑不被上一轮历史挡）**

这是**核心回归**：

```python
def test_rerun_not_blocked_by_previous_run_history(db_session, monkeypatch):
    """同一冻结计划第二轮：根任务不被第一轮的 success 历史判为'已派过'。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now

    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'
    db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    # A=根, B=依赖 A
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A)
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     orchestration_plan_id=plan.id, user_prompt="b"); db_session.add(B)
    db_session.flush()

    # 拦截真正派发，只记录"谁被派了"
    dispatched = []
    monkeypatch.setattr(ds, "_dispatch_successor",
                        lambda db, t, e, w, brief, run_id, stream_class=None: dispatched.append((t.id, run_id)))
    # 让员工/容量/槽位检查恒过
    monkeypatch.setattr(ds, "can_assign_to_employee", lambda db, eid: True)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    def _log(task_id, run_id, status, accepted=False):
        db_session.add(TaskExecutionLog(
            task_id=task_id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status=status, run_result="r",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id,
            qa_accepted_at=cst_now() if accepted else None))
        db_session.commit()

    # ── 第一轮 r1：A 已 success+accepted（历史） ──
    r1 = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    _log(A.id, r1.id, "success", accepted=True)

    # ── 第二轮 r2：A 在本轮 success+accepted，触发 on_employee_task_completed(A) ──
    r2 = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    _log(A.id, r2.id, "success", accepted=True)   # 本轮 A 完成
    ds.on_employee_task_completed(A.id, ws.id)

    # B 应在 r2 内被派（不被 r1 历史挡），且 run_id 是 r2
    assert (B.id, r2.id) in dispatched
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k rerun_not_blocked -v`
Expected: FAIL（`on_employee_task_completed` 还在用旧的无 run_id 查询 / `_dispatch_successor` 签名不符）。

- [ ] **Step 3: 改 on_employee_task_completed 按轮评估**

在 `on_employee_task_completed`（:393）函数体开头、`task = db.get(...)` 之后、构造 dep_map 之前，插入推导 run_id：

```python
        from src.service.agent.orchestrator.plan_run_service import (
            latest_run_id_for_task, settle_plan_run,
        )
        run_id = latest_run_id_for_task(db, task_id)
        if run_id is None:
            return  # 非编排日志（无 run）——无后继可派
```

把后续三处调用改为带 run_id：
- `status_by_task = _log_status_by_task(db, [t.id for t in tasks], run_id)`
- `accepted_ids = _load_accepted_task_ids(db, [t.id for t in tasks], run_id)`
- 级联跳过分支里 `_record_skip(db, t, workspace_id, "前置任务失败，已级联跳过", run_id)`
- 派发分支里 `prereq_refs = _collect_prereq_artifacts(db, dep_ids, run_id)`
- `_dispatch_successor(db, t, employee, workspace_id, briefing, run_id, stream_class=cls_by_id.get(cid))`

all_settled 分支（:531）改为收尾 run：

```python
        if not dispatched:
            all_settled = all(_is_settled(t.id, status_by_task) for t in tasks)
            if all_settled:
                settle_plan_run(db, run_id)
                db.commit()
                logger.info("plan=%s run=%s 全部定局（all_settled）", plan.id, run_id)
```

- [ ] **Step 4: 改 _dispatch_successor 透传 run_id**

`_dispatch_successor`（:602）加 `run_id` 位置参数，转给 `start_task_as_conversation(..., run_id=run_id)`：

```python
def _dispatch_successor(db, task, employee, workspace_id, prereq_briefing, run_id, *, stream_class=None) -> int:
    from src.service.agent.orchestrator.execution import start_task_as_conversation
    return start_task_as_conversation(
        db, task, employee, workspace_id,
        prereq_briefing=prereq_briefing, stream_class=stream_class, run_id=run_id,
    )
```

（`start_task_as_conversation` 的 `run_id` 形参在 Task 6 加；本 Task 测试已 monkeypatch 掉 `_dispatch_successor`，故此处签名先就位即可。）

- [ ] **Step 5: 改 release_accepted_downstream 按轮**

`release_accepted_downstream`（:546）内部调 `on_employee_task_completed(task_id, workspace_id)` 不变（它内部自推 run_id）。**无需改查询**——它扫的 log 自带 run_id，盖 `qa_accepted_at` 后 `on_employee_task_completed` 会按该 task 最新 log 的 run 评估。确认无遗漏即可（本 Step 仅核对，不改代码）。

- [ ] **Step 6: 跑核心测试 + 相关回归**

Run:
```
cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k rerun_not_blocked -v
uv run pytest tests/test_orchestrator_dag_gating.py tests/test_dependency_scheduler_failure.py -v
```
Expected: 核心测试 PASS；dag_gating / failure 测试可能因 `_load_accepted_task_ids` / `_log_status_by_task` 签名变化而 FAIL → 这些测试在 Task 7 统一适配；**此处记录哪些红**，先不修。

> 若 dag_gating 现有测试直接调 `_load_accepted_task_ids(db, [..])`（无 run_id），它们会 TypeError。处理：这些是既有测试，Task 7 专门有一步适配它们（给测试补 run 上下文）。本 Task 只保证新核心测试绿。

- [ ] **Step 7: Commit**

```bash
git add src/service/agent/orchestrator/dependency_scheduler.py tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): on_employee_task_completed 按轮推导 run_id 评估整盘 + 收尾 run"
```

---

## Task 5: execute_plan 开 run + 透传 run_id 到 start_task_as_conversation

**Files:**
- Modify: `src/service/agent/orchestrator/execution.py:127`（`execute_plan`）、`:161`（`start_immediate_tasks`）、`:232`（`start_task_as_conversation`）
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（root 首发日志带 run_id）**

```python
def test_execute_plan_opens_run_and_tags_root_log(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()

    # 截断真正起流：只让它建 TaskExecutionLog 然后返回（验证 run_id 落库）
    captured = {}
    def _fake_start(db, task, employee, workspace_id, *, priority=0, source="orchestration",
                    prereq_briefing="", stream_class=None, run_id=None):
        log = TaskExecutionLog(
            task_id=task.id, workspace_id=workspace_id, employee_id=employee.id, skill_id=None,
            task_name_snapshot=task.task_name, run_status="running", run_result="r",
            input_json="{}", output_json="{}", started_at=__import__("src.models.workspace", fromlist=["cst_now"]).cst_now(),
            run_id=run_id)
        db.add(log); db.commit()
        captured["run_id"] = run_id
        return 123
    monkeypatch.setattr(ex, "start_task_as_conversation", _fake_start)
    monkeypatch.setattr(ex, "can_assign_to_employee", lambda db, eid: True)

    ex.execute_plan(db_session, plan, ws.id)
    # 开了一轮 manual run，root 日志带该 run_id
    from src.models.plan_run import PlanRun
    run = db_session.scalars(__import__("sqlalchemy").select(PlanRun).where(PlanRun.plan_id == plan.id)).first()
    assert run is not None and run.trigger == "manual" and run.auto_accept is False
    assert captured["run_id"] == run.id
```

> （上面 `cst_now` 的 import 写法略绕，实现时可直接 `from src.models.workspace import cst_now` 放测试文件顶部。）

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k execute_plan_opens_run -v`
Expected: FAIL。

- [ ] **Step 3: execute_plan 开 run + 透传**

`execute_plan`（:127）改为：confirm 走的是 manual run（auto_accept=False）。递归计划（cron 非空）**只注册调度、不立即跑**（详见 Task 8，本 Task 先把 run 透传打通；递归短路在 Task 8 加）：

```python
def execute_plan(db: Session, plan: OrchestrationPlan, workspace_id: int) -> str:
    plan.status = "confirmed"
    plan.started_at = cst_now()
    db.commit()

    tasks = list(db.scalars(
        select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id)
        .order_by(EmployeeTask.priority.desc(), EmployeeTask.id.asc())
    ).all())

    immediate_tasks = [t for t in tasks if t.execute_mode == "immediate"]
    scheduled_tasks = [t for t in tasks if t.execute_mode == "scheduled"]

    results: list[str] = []
    if scheduled_tasks:
        from src.service.task_scheduler_service import TaskSchedulerService
        TaskSchedulerService.reload_jobs()
        results.append(f"{len(scheduled_tasks)} 个定时任务已加入调度队列")

    if immediate_tasks:
        from src.service.agent.orchestrator.plan_run_service import open_plan_run
        run = open_plan_run(db, plan.id, workspace_id, trigger="manual", auto_accept=False)
        db.commit()
        results += start_immediate_tasks(db, immediate_tasks, plan, workspace_id, run_id=run.id)

    return "\n".join([f"编排计划 #{plan.id} 执行中："] + results)
```

`start_immediate_tasks`（:161）加 `run_id` 形参，转给 `start_task_as_conversation(db, task, employee, workspace_id, stream_class=cls_by_id.get(tid), run_id=run_id)`。签名末尾加 `, run_id: int`。

- [ ] **Step 4: start_task_as_conversation 写 run_id**

`start_task_as_conversation`（:232）签名加 `run_id: int | None = None`；建 `run_log = TaskExecutionLog(...)`（:278）时加 `run_id=run_id`。

- [ ] **Step 5: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k execute_plan_opens_run -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/service/agent/orchestrator/execution.py tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): execute_plan 开 manual run + 透传 run_id 到首发/派发日志"
```

---

## Task 6: 返工新日志继承 run_id + invalidate_downstream/只读函数按轮

**Files:**
- Modify: `src/service/agent/orchestrator/rework.py:134`（new_log）、`src/service/agent/orchestrator/dependency_scheduler.py:220`（`invalidate_downstream`）、`:168`（`waiting_status_for_task`）、`:202`（`task_prereqs_accepted`）
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（返工继承 run_id + 只读按轮）**

```python
def test_rework_new_log_inherits_run_id(db_session, monkeypatch):
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    # 直接验证"新 log 复制 old.run_id"的语义：构造 old 带 run_id，跑继承逻辑片段。
    # （完整 redispatch 涉及起流，单测聚焦 run_id 继承——见集成测试覆盖端到端。）
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    run = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    old = TaskExecutionLog(task_id=5, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="success", run_result="r", input_json="{}",
        output_json="{}", conversation_id=1, orchestrator_conversation_id=9,
        started_at=cst_now(), run_id=run.id)
    db_session.add(old); db_session.commit()
    # 模拟 rework 建 new_log 的字段集（实现里 new_log.run_id = old.run_id）
    new_log = TaskExecutionLog(task_id=5, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="queued", run_result="返工中",
        input_json="{}", output_json="{}", conversation_id=1,
        orchestrator_conversation_id=9, started_at=cst_now(), run_id=old.run_id)
    db_session.add(new_log); db_session.commit()
    assert new_log.run_id == run.id
```

> 这条测试守住"new_log 带 old.run_id"的契约；真正的端到端返工在 Task 9 集成测试里跑。

- [ ] **Step 2: 跑确认失败**（此刻 rework.py 的 new_log 还没 run_id，测试虽自建 new_log 能过——故改为先验证 rework.py 源码契约）。

实操：本测试主要防回归。**先在 rework.py 落实继承**，再让一条针对 `redispatch_task_in_session` 的最小集成断言（Task 9）覆盖。这里 Step 1 测试本身不依赖 rework.py，跑应直接 PASS——故 Step 2 改为：

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k rework_new_log_inherits -v`
Expected: PASS（契约测试）。然后继续 Step 3 改源码以满足真实路径。

- [ ] **Step 3: rework.py new_log 继承 run_id**

`rework.py` 取 old log 后（:81-85 已取 `old`），在建 `new_log`（:134）时加：

```python
            run_id=old.run_id,   # 返工不新开 run，沿用所在轮
```

- [ ] **Step 4: invalidate_downstream / 只读函数按轮**

`invalidate_downstream`（:220）：在取到 `task` 后推导 `run_id = latest_run_id_for_task(db, task_id)`；其内查下游最新 log（:251-255）追加 `TaskExecutionLog.run_id == run_id` 过滤（只作废本轮下游）。`from ...plan_run_service import latest_run_id_for_task`。

`waiting_status_for_task`（:168）与 `task_prereqs_accepted`（:202）：调 `_load_accepted_task_ids` 处补 run_id 实参——取该 plan 最新 run：`run_id = latest_run_id_for_plan(db, plan.id)`；若为 None（计划从未跑过）→ 这两个函数对"已接受集"按空集处理（`_load_accepted_task_ids` 收到 None 时返回空——实现里 `if run_id is None: return set()` 守卫，或调用方先判 None）。

> 实现建议：在 `_load_accepted_task_ids` 顶部加 `if run_id is None: return set()`，让只读函数无 run 时退化为"无接受"，语义安全（无 run = 还没跑 = 没接受）。

- [ ] **Step 5: 跑确认通过 + 返工相关回归**

Run:
```
cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k rework_new_log_inherits -v
uv run pytest tests/test_orchestrator_rework.py tests/test_orchestrator_rework_invalidation.py -v
```
Expected: 新测试 PASS；返工套件若因 `waiting_status_for_task`/`task_prereqs_accepted` 签名或行为变化而红 → 适配（给这些既有测试补 run 上下文，见 Task 7 同款手法）。记录红项。

- [ ] **Step 6: Commit**

```bash
git add src/service/agent/orchestrator/rework.py src/service/agent/orchestrator/dependency_scheduler.py tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): 返工新日志继承 run_id + invalidate/只读函数按轮收敛"
```

---

## Task 7: auto_accept 自动放行（finalize 钩子）+ 适配既有测试

**Files:**
- Modify: `src/service/stream_registry.py:2463`（`db.refresh(log)` 后）
- Modify（适配）: `tests/test_orchestrator_dag_gating.py`、`tests/test_dependency_scheduler_failure.py` 等因签名变化变红的既有测试
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（scheduled run 自动盖 qa_accepted_at）**

```python
def test_auto_accept_stamps_qa_for_scheduled_run(db_session):
    from src.service.stream_registry import _auto_accept_if_scheduled_run
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    sched = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    manual = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)

    def _log(run_id, status="success"):
        l = TaskExecutionLog(task_id=1, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status=status, run_result="r", input_json="{}",
            output_json="{}", started_at=cst_now(), run_id=run_id)
        db_session.add(l); db_session.commit(); db_session.refresh(l); return l

    sched_log = _log(sched.id)
    _auto_accept_if_scheduled_run(db_session, sched_log)
    db_session.refresh(sched_log)
    assert sched_log.qa_accepted_at is not None     # 定时轮自动放行

    manual_log = _log(manual.id)
    _auto_accept_if_scheduled_run(db_session, manual_log)
    db_session.refresh(manual_log)
    assert manual_log.qa_accepted_at is None        # 交互式不自动盖

    failed_log = _log(sched.id, status="failed")
    _auto_accept_if_scheduled_run(db_session, failed_log)
    db_session.refresh(failed_log)
    assert failed_log.qa_accepted_at is None        # 仅 success 放行
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k auto_accept_stamps -v`
Expected: FAIL（`_auto_accept_if_scheduled_run` 不存在）。

- [ ] **Step 3: 实现 auto_accept 钩子**

`src/service/stream_registry.py`，在 `_capture_journal_safe` 等 helper 旁（:2339 一带）加：

```python
def _auto_accept_if_scheduled_run(db, log) -> None:
    """无人值守定时轮：员工任务 success 即自动盖 qa_accepted_at，复用现成派发闸放行下游。

    仅当该 log 属 auto_accept=True 的 PlanRun 且本条为 success 时生效。容错、不抛。
    """
    try:
        if log is None or log.run_id is None or log.run_status != "success":
            return
        if log.qa_accepted_at is not None:
            return
        from src.models.plan_run import PlanRun
        from src.models.workspace import cst_now
        run = db.get(PlanRun, log.run_id)
        if run is not None and run.auto_accept:
            log.qa_accepted_at = cst_now()
            db.commit()
            db.refresh(log)
    except Exception:
        logger.warning("auto-accept scheduled run failed log=%s", getattr(log, "id", None), exc_info=True)
```

在 `_finalize_task_stream` 的 `db.refresh(log)`（:2463）之后、`_capture_journal_safe(db, log)`（:2464）之前插一行：

```python
        _auto_accept_if_scheduled_run(db, log)   # 定时轮无人值守自动放行
```

> 时序：auto_accept 必须在 `on_task_finalized`（:2488，触发 `on_employee_task_completed` 派下游）之前盖好，否则下游评估时还没接受。:2463→:2488 之间插入满足该约束。

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k auto_accept_stamps -v`
Expected: PASS。

- [ ] **Step 5: 适配既有测试的签名变化**

跑会受影响的既有套件，逐一适配（给调用 `_load_accepted_task_ids`/`_log_status_by_task` 的测试补一个 run 上下文：先 `open_plan_run` 拿 run.id，seed log 时带 `run_id=run.id`，调用时传该 run_id）：

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py tests/test_dependency_scheduler_failure.py tests/test_orchestrator_rework.py tests/test_orchestrator_rework_invalidation.py -v`

对每个红测试：在其 `_seed_log` 辅助里加 `run_id` 参数并在断言调用处传入对应 run。`test_all_prereqs_accepted_pure` 是纯函数不受影响（不动）。

- [ ] **Step 6: 全量回归**

Run: `cd apps/server && uv run pytest -q`
Expected: 相对开工基线零新增 failed。记录 `N passed`。

- [ ] **Step 7: Commit**

```bash
git add src/service/stream_registry.py tests/
git commit -m "feat(orch): 定时轮 auto_accept finalize 自动盖 qa_accepted_at + 适配既有测试按 run"
```

---

## Task 8: 调度器计划级 job + run_plan_job + 工具计划级 schedule

**Files:**
- Modify: `src/service/task_scheduler_service.py:90`（`reload_jobs`）、加 `run_plan_job`
- Modify: `src/service/agent/orchestrator/tools/plans.py:29`（工具签名/落库）、`execute_plan` 递归短路
- Modify: `src/service/agent/orchestrator/execution.py:127`（递归计划不立即跑）
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写失败测试（run_plan_job 开 scheduled run + 不调总管）**

```python
def test_run_plan_job_opens_scheduled_run_without_curator(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    from src.models.employee_task import EmployeeTask
    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True; plan.plan_json = '[{"depends_on": null}]'
    db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()

    # 用测试库
    sf = __import__("sqlalchemy.orm", fromlist=["sessionmaker"]).sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    # 截断 start_immediate_tasks：记录被调 + run_id
    seen = {}
    import src.service.agent.orchestrator.execution as ex
    monkeypatch.setattr(ex, "start_immediate_tasks",
                        lambda db, tasks, plan, ws_id, run_id: seen.setdefault("run_id", run_id) or [])
    # 守卫：绝不调总管定时入口
    monkeypatch.setattr(tss.TaskSchedulerService, "_start_curator_task",
                        classmethod(lambda cls, *a, **k: (_ for _ in ()).throw(AssertionError("不该调总管"))))

    tss.TaskSchedulerService.run_plan_job(plan.id)

    from src.models.plan_run import PlanRun
    with sf() as d:
        run = d.scalars(__import__("sqlalchemy").select(PlanRun).where(PlanRun.plan_id == plan.id)).first()
        assert run is not None and run.trigger == "scheduled" and run.auto_accept is True
    assert seen.get("run_id") is not None
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k run_plan_job_opens -v`
Expected: FAIL（`run_plan_job` 不存在）。

- [ ] **Step 3: 实现 run_plan_job**

`src/service/task_scheduler_service.py` 加类方法：

```python
    @classmethod
    def run_plan_job(cls, plan_id: int) -> None:
        """递归计划到点：开一轮新 scheduled run，直接重跑冻结 DAG 根任务。

        绝不调 _start_curator_task / 不重发总管消息 / 不重新分析分单。
        """
        from src.models.orchestration_plan import OrchestrationPlan
        from src.service.agent.orchestrator.execution import start_immediate_tasks
        from src.service.agent.orchestrator.plan_run_service import open_plan_run

        with get_session_local()() as db:
            plan = db.get(OrchestrationPlan, plan_id)
            if plan is None or plan.status != "confirmed" or not (plan.cron or "").strip():
                return
            tasks = list(db.scalars(
                select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan_id)
                .order_by(EmployeeTask.priority.desc(), EmployeeTask.id.asc())
            ).all())
            if not tasks:
                return
            run = open_plan_run(db, plan_id, plan.workspace_id, trigger="scheduled", auto_accept=True)
            db.commit()
            try:
                start_immediate_tasks(db, tasks, plan, plan.workspace_id, run_id=run.id)
            except Exception:
                logger.error("run_plan_job 派发失败 plan=%s run=%s", plan_id, run.id, exc_info=True)
            plan.last_run_at = cst_now()
            plan.next_run_at = TaskService.compute_next_run(plan.cron, now=plan.last_run_at)
            db.commit()
            logger.info("递归计划到点 plan=%s run_seq=%s（绕开总管重分析）", plan_id, run.run_seq)
```

> 注意：`start_immediate_tasks` 只派**根任务**（无依赖），下游由 `on_employee_task_completed` 完成驱动——与交互式同一套，run_id 已透传。

- [ ] **Step 4: reload_jobs 挂计划级 job + 排除编排子任务**

`reload_jobs`（:90）的 `EmployeeTask` 扫描 where 子句**追加** `EmployeeTask.orchestration_plan_id.is_(None)`（编排子任务不再各自挂 task 级 job）。

在该函数末尾、`cls._register_system_jobs()` 之前，新增一段扫描递归计划挂计划级 job：

```python
            from src.models.orchestration_plan import OrchestrationPlan
            plans = list(db.scalars(
                select(OrchestrationPlan).where(
                    OrchestrationPlan.status == "confirmed",
                    OrchestrationPlan.cron.isnot(None),
                    func.trim(OrchestrationPlan.cron) != "",
                )
            ).all())
            for plan in plans:
                cron = (plan.cron or "").strip()
                if TaskService.compute_next_run(cron, now=now) is None:
                    logger.warning("跳过无法解析的计划级 cron plan_id=%s cron=%r", plan.id, cron)
                    continue
                job_id = f"plan:{plan.id}"
                scheduler.add_job(
                    cls.run_plan_job, trigger=CronTrigger.from_crontab(cron, timezone=CST),
                    id=job_id, args=[plan.id], replace_existing=True,
                    max_instances=1, coalesce=True, misfire_grace_time=120,
                )
                job = scheduler.get_job(job_id)
                plan.next_run_at = job.next_run_time if job else TaskService.compute_next_run(cron)
            db.commit()
```

并在 `reload_jobs` 顶部移除旧 plan 级 job：循环 `scheduler.get_jobs()` 时也移除 `job.id.startswith("plan:")`（与现有 `_job_prefix` 清理并列加一个 `plan:` 前缀清理）。

- [ ] **Step 5: 工具计划级 schedule + 递归只调度不即跑**

`src/service/agent/orchestrator/tools/plans.py`：
- `create_orchestration_plan` 签名加 `schedule: str | None = None`。docstring 把节拍语义从 per-task `cron` 上移到 plan 级（`schedule`），删 per-task `cron` 字段说明（编排弃用）。
- 解析：`from src.service.task_scheduler_service import parse_nl_cron`；`plan_cron = parse_nl_cron(schedule) if schedule else None`。建 `OrchestrationPlan(...)` 时加 `cron=plan_cron, is_recurring=bool(plan_cron)`。
- 子任务建 `EmployeeTask` 时：递归计划（plan_cron 非空）下，子任务 `cron_expression=""`、`execute_mode="immediate"`（它们由 run_plan_job 按轮派，不各自挂 cron）。

`src/service/agent/orchestrator/execution.py` 的 `execute_plan`（Task 5 已改）追加递归短路——在算出 immediate/scheduled 之后：

```python
    if (plan.cron or "").strip():
        # 递归计划：只注册计划级调度，首轮在首个节拍触发，不立即跑。
        from src.service.task_scheduler_service import TaskSchedulerService
        plan.is_recurring = True
        db.commit()
        TaskSchedulerService.reload_jobs()
        return f"编排计划 #{plan.id} 已设为定时（{plan.cron}），将在每个节拍自动执行。"
```

把这段放在 `immediate_tasks` 派发**之前**（递归计划直接 return，不开 manual run、不立即跑）。

- [ ] **Step 6: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k "run_plan_job_opens" -v`
Expected: PASS。

- [ ] **Step 7: 工具层测试（schedule 落库 + 递归不即跑）**

追加测试：

```python
def test_create_plan_with_schedule_sets_plan_cron(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_nl_cron", lambda s: "0 10 * * *", raising=False)
    # 防真正执行/起调度
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "scheduled")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "热搜", "prompt": "查热搜", "depends_on": None}]
    tp.create_orchestration_plan.func("每天查热搜", tasks, schedule="每天10点")
    from src.models.orchestration_plan import OrchestrationPlan
    plan = db_session.scalars(__import__("sqlalchemy").select(OrchestrationPlan)).first()
    assert plan.cron == "0 10 * * *" and plan.is_recurring is True
```

> `create_orchestration_plan.func(...)` 调底层函数绕过 `@tool` 包装。`validate_orchestration_tasks` 需要 tasks 合法——按现有 `test_create_orchestration_plan.py` 的最小合法任务结构对齐字段。

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k create_plan_with_schedule -v`
Expected: PASS（按需补字段直至 validation 过）。

- [ ] **Step 8: Commit**

```bash
git add src/service/task_scheduler_service.py src/service/agent/orchestrator/tools/plans.py src/service/agent/orchestrator/execution.py tests/
git commit -m "feat(orch): 计划级 cron job + run_plan_job 绕开总管重分析 + 工具 schedule 参数"
```

---

## Task 9: 端到端集成 + 全量回归

**Files:**
- Test: `tests/test_scheduled_recurring_orchestration.py`

- [ ] **Step 1: 写两轮重跑端到端集成测试**

模拟：递归计划 → run_plan_job 两次 → 每轮根任务派发、用 finalize 自动放行驱动下游、断言两轮互不卡死、下游各跑一次于本轮。用 monkeypatch 把 `start_task_as_conversation` 的"起流"截成"立即建 success log + 触发 on_employee_task_completed"，形成可控的同步链：

```python
def test_two_scheduled_runs_end_to_end(db_session, monkeypatch):
    """run_plan_job ×2：每轮 A→B 全链跑通，第二轮不被第一轮历史挡，B 各属各轮。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    import src.service.agent.orchestrator.dependency_scheduler as ds
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    from sqlalchemy.orm import sessionmaker

    sf = sessionmaker(bind=db_session.get_bind())
    for mod in (tss, ds):
        monkeypatch.setattr(mod, "get_session_local", lambda: sf, raising=False)

    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="b")
    db_session.add_all([A, B]); db_session.commit()

    monkeypatch.setattr(ds, "can_assign_to_employee", lambda db, eid: True)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    # 把"起流"换成"同步建 success log + auto_accept + 完成驱动"
    def _fake_start(db, task, employee, workspace_id, *, priority=0, source="orchestration",
                    prereq_briefing="", stream_class=None, run_id=None):
        log = TaskExecutionLog(task_id=task.id, workspace_id=workspace_id, employee_id=employee.id,
            skill_id=None, task_name_snapshot=task.task_name, run_status="success", run_result="ok",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id)
        db.add(log); db.commit(); db.refresh(log)
        sr._auto_accept_if_scheduled_run(db, log)
        ds.on_employee_task_completed(task.id, workspace_id)
        return log.conversation_id or 1
    monkeypatch.setattr(ex, "start_task_as_conversation", _fake_start)
    monkeypatch.setattr(ds, "_dispatch_successor",
        lambda db, t, e, w, brief, rid, stream_class=None: _fake_start(db, t, e, w, run_id=rid))

    # 第一轮 & 第二轮
    tss.TaskSchedulerService.run_plan_job(plan.id)
    tss.TaskSchedulerService.run_plan_job(plan.id)

    from src.models.plan_run import PlanRun
    runs = db_session.scalars(__import__("sqlalchemy").select(PlanRun).where(PlanRun.plan_id == plan.id)
                              .order_by(PlanRun.run_seq)).all()
    assert [r.run_seq for r in runs] == [1, 2]
    # 每轮 A、B 各一条 success 日志，run_id 各属各轮
    for r in runs:
        logs = db_session.scalars(__import__("sqlalchemy").select(TaskExecutionLog)
            .where(TaskExecutionLog.run_id == r.id)).all()
        names = sorted(l.task_name_snapshot for l in logs)
        assert names == ["A", "B"], f"run {r.run_seq} 应有 A、B 各一条，实得 {names}"
```

- [ ] **Step 2: 跑集成测试**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k two_scheduled_runs -v`
Expected: PASS（第二轮 A 不被第一轮历史挡、B 在各自轮内衔接）。若红，用 `superpowers:systematic-debugging` 定位（多为 run_id 透传/推导漏点）。

- [ ] **Step 3: 全量回归**

Run: `cd apps/server && uv run pytest -q`
Expected: 相对开工基线**零新增 failed**；本特性新增测试全绿。

- [ ] **Step 4: Commit**

```bash
git add tests/test_scheduled_recurring_orchestration.py
git commit -m "test(orch): 两轮定时重跑端到端集成——不卡死、下游各属各轮"
```

---

## 完成标准（验收）

- [ ] 全量 `uv run pytest -q` 相对基线零新增 failed。
- [ ] 核心回归 `test_rerun_not_blocked_by_previous_run_history` + `test_two_scheduled_runs_end_to_end` 绿。
- [ ] `run_plan_job` 不调 `_start_curator_task`（测试 monkeypatch 守卫）。
- [ ] 交互式 QA/返工既有套件（dag_gating / rework / rework_invalidation）适配后全绿。
- [ ] 独立手动/MCP 定时任务（`orchestration_plan_id IS NULL`）的 `run_task_job` 路径未被触碰、相关测试不红。

## 收尾（实现完成后）

- 用 `superpowers:requesting-code-review` 对整条 diff 做一次复审（重点：run_id 透传无遗漏、auto_accept 时序在 on_task_finalized 之前、reload_jobs 不双重调度）。
- 手测剧本（spec §11）：总管发"每天X点查热搜→总结文档"→确认→看 `plan:{id}` job 已挂、不立即跑；手动 `run_plan_job(plan_id)` 触发一轮→热搜+文档自动跑完、总管收到汇报；再触发一轮不卡死。
- 更新记忆 [[scheduled-recurring-orchestration-plan]] 标记落地。

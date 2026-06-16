# 下游派发以 QA 接受为闸（DAG-QA gating）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 下游任务只在上游被总管接受（评审过且未返工）后才派发，消除"下游基于被否决的上游数据先行交付"。

**Architecture:** 加一列 `TaskExecutionLog.qa_accepted_at` 作"接受"标记；派发门槛从"前置 success"改为"前置已接受（直查 DB）"；总管评审流收尾时跑放行对账（盖 qa_accepted_at + 放行下游），启动对账兜底。纯后端。

**Tech Stack:** Python FastAPI + SQLAlchemy（`uv`）。

**关联 spec：** [docs/superpowers/specs/2026-06-17-orchestrator-qa-dag-gating-design.md](../specs/2026-06-17-orchestrator-qa-dag-gating-design.md)

**基线（改动后零新增失败）：**
- 后端：`cd apps/server && uv run pytest -q` → 5 failed / 583 passed（含上一特性 QA-rework 的新测试）
- 前端不动。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/server/src/models/task_execution_log.py` | 加 `qa_accepted_at` | Modify |
| `apps/server/src/db/init_db.py` | `qa_accepted_at` ensure_column | Modify |
| `apps/server/src/service/agent/orchestrator/dependency_scheduler.py` | 接受谓词 `_load_accepted_task_ids`/`_all_prereqs_accepted` + 替换派发门槛 + `release_accepted_downstream` + `reconcile_accepted_downstream_all` | Modify |
| `apps/server/src/service/stream_registry.py` | 评审流收尾调放行对账 | Modify |
| `apps/server/src/server.py` | 启动对账补盖 | Modify |
| `apps/server/tests/test_orchestrator_dag_gating.py` | 谓词 + 放行对账 + 情景B回归 | Create |

---

## Task 1: `qa_accepted_at` 列 + 迁移

**Files:**
- Modify: `apps/server/src/models/task_execution_log.py:37`（紧邻 `reported_at` 加同款列）
- Modify: `apps/server/src/db/init_db.py:83`（`reported_at` ensure_column 旁加一行）
- Test: `apps/server/tests/test_orchestrator_dag_gating.py`（Create）

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_orchestrator_dag_gating.py
from src.models.task_execution_log import TaskExecutionLog


def test_execution_log_has_qa_accepted_at_field():
    assert "qa_accepted_at" in TaskExecutionLog.__table__.columns
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py::test_execution_log_has_qa_accepted_at_field -v`
Expected: FAIL

- [ ] **Step 3: 模型加列**

`task_execution_log.py` 在 `reported_at` 行下方加（仿其 `DateTime(timezone=True), nullable=True`）：
```python
    qa_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 4: init_db 迁移**

`init_db.py` 在 `ensure_column("task_execution_logs", "reported_at", ...)` 旁加：
```python
    ensure_column("task_execution_logs", "qa_accepted_at", "qa_accepted_at DATETIME")
```

- [ ] **Step 5: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py::test_execution_log_has_qa_accepted_at_field -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/models/task_execution_log.py apps/server/src/db/init_db.py apps/server/tests/test_orchestrator_dag_gating.py
git commit -m "feat(orchestrator): TaskExecutionLog.qa_accepted_at 列 + 迁移"
```

---

## Task 2: 接受谓词 + 替换派发门槛

**说明：** 后继可派条件从"前置 success"改为"前置已接受"。**直查 DB**（避免 `_log_status_by_task` 的 set 语义陷阱）。

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/dependency_scheduler.py`（`_all_prereqs_done` 旁加新谓词；`on_employee_task_completed` 派发分支 ~line 351 替换门槛）
- Test: `apps/server/tests/test_orchestrator_dag_gating.py`（append）

参考：`_all_prereqs_done(dep_ids, status_by_task)`（line 143，纯函数）、`_PREREQ_DONE_STATES = ("completed","success")`（line 36）、`on_employee_task_completed` 在 line 313 后已有 `status_by_task = _log_status_by_task(...)`。

- [ ] **Step 1: 写失败测试（纯谓词 + DB 加载器）**

```python
# append to test_orchestrator_dag_gating.py
import json
from sqlalchemy import select
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.conversation import Conversation
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now


def _seed_log(db, *, task_id, ws_id, emp_id, run_status="success",
              reported=True, accepted=False, orch_conv=999):
    log = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot="t", run_status=run_status, run_result="r",
        input_json="{}", output_json="{}", conversation_id=None,
        orchestrator_conversation_id=orch_conv, started_at=cst_now(),
        ended_at=cst_now(),
        reported_at=cst_now() if reported else None,
        qa_accepted_at=cst_now() if accepted else None,
    )
    db.add(log); db.commit()
    return log


def test_all_prereqs_accepted_pure():
    from src.service.agent.orchestrator.dependency_scheduler import _all_prereqs_accepted
    assert _all_prereqs_accepted([1, 2], {1, 2}) is True
    assert _all_prereqs_accepted([1, 2], {1}) is False
    assert _all_prereqs_accepted([], set()) is True  # 无前置 → 真（根任务不受影响由调用处另判）


def test_load_accepted_task_ids_excludes_unaccepted_and_superseded(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import _load_accepted_task_ids
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    # task 1: success + accepted → 入选
    _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, accepted=True)
    # task 2: success 但未接受 → 不入选
    _seed_log(db_session, task_id=2, ws_id=ws.id, emp_id=emp.id, accepted=False)
    # task 3: superseded（即便误盖 accepted 也应因 run_status 被排除）
    _seed_log(db_session, task_id=3, ws_id=ws.id, emp_id=emp.id, run_status="superseded", accepted=True)
    got = _load_accepted_task_ids(db_session, [1, 2, 3])
    assert got == {1}
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py -k "accepted" -v`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现谓词 + 加载器**

`dependency_scheduler.py` 在 `_all_prereqs_done` 之后加（`select` 已在模块顶 import；`TaskExecutionLog` 按本文件既有风格在函数内 import）：
```python
def _load_accepted_task_ids(db: Session, task_ids: list[int]) -> set[int]:
    """直查 DB 取"已 QA 接受"的前置 task 集合：存在 success/completed 且 qa_accepted_at 非空的 log。
    直查而非走 _log_status_by_task 的 set——后者表达不了"哪条 log 被接受"。"""
    from src.models.task_execution_log import TaskExecutionLog
    if not task_ids:
        return set()
    rows = db.execute(
        select(TaskExecutionLog.task_id)
        .where(
            TaskExecutionLog.task_id.in_(task_ids),
            TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
            TaskExecutionLog.qa_accepted_at.is_not(None),
        )
        .distinct()
    ).all()
    return {r[0] for r in rows}


def _all_prereqs_accepted(dep_ids: list[int], accepted_ids: set[int]) -> bool:
    """所有前置都已 QA 接受 → 下游可派。"""
    return all(d in accepted_ids for d in dep_ids)
```

- [ ] **Step 4: 替换派发门槛**

在 `on_employee_task_completed` 内、`status_by_task = _log_status_by_task(...)` 之后加：
```python
        accepted_ids = _load_accepted_task_ids(db, [t.id for t in tasks])
```
把派发分支（~line 351）的
```python
            if not _all_prereqs_done(dep_ids, status_by_task):
                continue  # 还有前置没完成，等下一次完成事件再来
```
改为：
```python
            if not _all_prereqs_accepted(dep_ids, accepted_ids):
                continue  # 还有前置未被总管接受，等放行对账再来
```
（`_all_prereqs_done` 函数本身保留——可能别处仍引用；只换调用点。若 grep 确认无其他引用，可一并删除，但**非必须**，YAGNI 下保留即可。）

- [ ] **Step 5: 跑确认通过 + 全量**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py -k "accepted" -v && uv run pytest -q`
Expected: 新测试 PASS；全量 5 failed / 586 passed（+3 新测试），零新增失败。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/dependency_scheduler.py apps/server/tests/test_orchestrator_dag_gating.py
git commit -m "feat(orchestrator): 派发门槛改为「前置已QA接受」(直查DB)"
```

---

## Task 3: 放行对账 `release_accepted_downstream` + 启动全量变体

**说明：** 总管评审流收尾时，对"评审过、仍 success、未被打回、尚未接受"的 log 盖 `qa_accepted_at` 并放行下游。

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/dependency_scheduler.py`（加两函数）
- Test: `apps/server/tests/test_orchestrator_dag_gating.py`（append）

- [ ] **Step 1: 写失败测试（放行对账盖标记 + 幂等 + 情景B回归）**

```python
# append
def test_release_stamps_accepted_and_is_idempotent(db_session, monkeypatch):
    import src.service.agent.orchestrator.dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: db_session))
    calls = []
    monkeypatch.setattr(ds, "on_employee_task_completed", lambda tid, wid: calls.append(tid))
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    log = _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, accepted=False, orch_conv=777)
    n = ds.release_accepted_downstream(777)
    assert n == 1
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, log.id).qa_accepted_at is not None
    assert calls == [1]  # 放行下游：调了 on_employee_task_completed(task=1)
    # 幂等：再调一次不重复
    calls.clear()
    assert ds.release_accepted_downstream(777) == 0
    assert calls == []


def test_release_skips_superseded_and_unreported(db_session, monkeypatch):
    import src.service.agent.orchestrator.dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: db_session))
    monkeypatch.setattr(ds, "on_employee_task_completed", lambda tid, wid: None)
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, run_status="superseded", orch_conv=888)
    _seed_log(db_session, task_id=2, ws_id=ws.id, emp_id=emp.id, reported=False, orch_conv=888)  # 未 reported
    assert ds.release_accepted_downstream(888) == 0
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py -k "release" -v`
Expected: FAIL

- [ ] **Step 3: 实现**

**必做前置（否则测试 monkeypatch 静默失效）**：`get_session_local` 当前是 `on_employee_task_completed` 内的**函数局部** import（`dependency_scheduler.py:276`）。**必须**把它提到**模块顶部** import 区：`from src.db.session import get_session_local`，并**删除** `on_employee_task_completed` 内那行局部 import。测试通过 `monkeypatch.setattr(ds, "get_session_local", ...)` 替换——只有模块级属性才被 patch 到；若保留函数内 import，patch 命不中、会静默走生产库。

`dependency_scheduler.py` 加（`TaskExecutionLog` 按本文件风格在函数内 import）：

```python
def release_accepted_downstream(orchestrator_conversation_id: int) -> int:
    """总管评审轮收尾对账：对已评审、仍 success、未被打回、尚未接受的 log 盖
    qa_accepted_at 并放行其下游。返回新接受数。幂等（qa_accepted_at 一次性）。"""
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    db = get_session_local()()
    try:
        logs = list(db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.orchestrator_conversation_id == orchestrator_conversation_id,
                TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
                TaskExecutionLog.reported_at.is_not(None),
                TaskExecutionLog.qa_accepted_at.is_(None),
            )
        ).all())
        if not logs:
            return 0
        now = cst_now()
        released: list[tuple[int, int]] = []
        for log in logs:
            log.qa_accepted_at = now
            released.append((log.task_id, log.workspace_id))
        db.commit()
        for task_id, workspace_id in released:
            try:
                on_employee_task_completed(task_id, workspace_id)
            except Exception:
                logger.warning("release downstream for task=%s failed", task_id, exc_info=True)
        logger.info(
            "release_accepted_downstream conv=%s accepted=%d",
            orchestrator_conversation_id, len(released),
        )
        return len(released)
    finally:
        db.close()


def reconcile_accepted_downstream_all(db: Session) -> int:
    """启动对账：扫描所有总管会话中"漏接受"的 log，逐会话放行。返回总接受数。"""
    from src.models.task_execution_log import TaskExecutionLog
    conv_ids = [
        r[0] for r in db.execute(
            select(TaskExecutionLog.orchestrator_conversation_id).where(
                TaskExecutionLog.orchestrator_conversation_id.is_not(None),
                TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
                TaskExecutionLog.reported_at.is_not(None),
                TaskExecutionLog.qa_accepted_at.is_(None),
            ).distinct()
        ).all()
    ]
    total = 0
    for cid in conv_ids:
        total += release_accepted_downstream(cid)
    return total
```

注：`on_employee_task_completed` 须在本函数定义**之前或同模块**可见（同模块即可，Python 运行时解析）。

- [ ] **Step 4: 跑确认通过 + 全量**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py -k "release" -v && uv run pytest -q`
Expected: 新测试 PASS；全量 5 failed / 588 passed（+2），零新增。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/dependency_scheduler.py apps/server/tests/test_orchestrator_dag_gating.py
git commit -m "feat(orchestrator): 放行对账 release_accepted_downstream + 启动全量变体"
```

---

## Task 4: 接线两个触发点（评审流收尾 + 启动）

**说明：** 运行时——总管评审流收尾调放行对账；启动——补盖。两处都难进确定性单测（依赖流/启动），靠 Task 3 的对账单测 + 人工冒烟覆盖。

**Files:**
- Modify: `apps/server/src/service/stream_registry.py:2208-2216`（`on_stream_end` 之后）
- Modify: `apps/server/src/server.py:125-140`（`reconcile_unreported_tasks` 之后）

- [ ] **Step 1: 评审流收尾接线**

`stream_registry.py` 在 `get_report_debouncer().on_stream_end(orchestrator_conversation_id)` 调用之后、同一 `if orchestrator_conversation_id is not None:` 块内加（仅对总管自己的流跑，省无谓扫描）：
```python
                # 总管自己的评审/对话流收尾 → 放行已被接受(评审过且未返工)的上游的下游。
                # 员工任务流(conversation_id != orchestrator_conversation_id)此刻刚完成的 log
                # reported_at 尚空，不满足对账条件，故无需为其跑；用相等判别只跑总管流。
                if conversation_id == orchestrator_conversation_id:
                    try:
                        from src.service.agent.orchestrator.dependency_scheduler import (
                            release_accepted_downstream,
                        )
                        release_accepted_downstream(orchestrator_conversation_id)
                    except Exception:
                        logger.warning(
                            "[run] conv=%s finally: release_accepted_downstream 失败",
                            conversation_id, exc_info=True,
                        )
```
（确认该 finally 作用域内 `conversation_id` 变量可见——它是本流的会话 id。）

- [ ] **Step 2: 启动对账接线**

`server.py` 在重启对账（`reconcile_unreported_tasks` 那段）之后加：
```python
        # 启动对账（QA 接受）：补盖漏接受的 qa_accepted_at 并放行下游
        try:
            from src.service.agent.orchestrator.dependency_scheduler import (
                reconcile_accepted_downstream_all,
            )
            with get_session_local()() as _qa_db:
                _accepted = reconcile_accepted_downstream_all(_qa_db)
            if _accepted:
                logger.info("启动对账(QA接受)：补盖+放行下游 %d 条", _accepted)
        except Exception:
            logger.warning("启动对账(QA接受)失败", exc_info=True)
```

- [ ] **Step 3: 静态核验（导入不破 + 变量在作用域）**

Run: `cd apps/server && uv run python -c "import src.service.stream_registry; import src.server; print('import OK')"`
Expected: `import OK`
并人工核对：`stream_registry.py` 该 finally 块内 `conversation_id` 确实已定义（它是 run 的入参/局部）。

- [ ] **Step 4: 全量回归**

Run: `cd apps/server && uv run pytest -q`
Expected: 5 failed / 588 passed，零新增。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/stream_registry.py apps/server/src/server.py
git commit -m "feat(orchestrator): 接线放行对账(评审流收尾 + 启动补盖)"
```

---

## Task 5: 情景B集成回归 + 端到端自检

**说明：** 在 DB 状态层模拟 spec 情景B（上游 success→打回返工→返工success→接受→放行），断言"下游可派"谓词只在最终接受后翻真。不触真实流（用 monkeypatch 隔离 on_employee_task_completed 的派发）。

**Files:**
- Test: `apps/server/tests/test_orchestrator_dag_gating.py`（append）

- [ ] **Step 1: 写集成回归测试**

```python
def test_scenario_b_downstream_gated_until_rework_accepted(db_session, monkeypatch):
    """情景B:上游被打回→返工→接受,下游谓词只在最终接受后翻真。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: db_session))
    monkeypatch.setattr(ds, "on_employee_task_completed", lambda tid, wid: None)
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A, B = 1, 2  # A=热搜(前置), B=Word(下游)

    # ① A 首次 success(已 reported,未接受) → B 还不能派
    l1 = _seed_log(db_session, task_id=A, ws_id=ws.id, emp_id=emp.id, accepted=False, orch_conv=555)
    assert ds._all_prereqs_accepted([A], ds._load_accepted_task_ids(db_session, [A, B])) is False

    # ② 总管打回:l1 superseded(模拟 redispatch),A 返工新 log l2(queued→还没 success)
    l1.run_status = "superseded"; db_session.commit()
    l2 = _seed_log(db_session, task_id=A, ws_id=ws.id, emp_id=emp.id,
                   run_status="queued", reported=False, accepted=False, orch_conv=555)
    # 评审流收尾对账:l1 superseded 排除、l2 未 success → 无接受 → B 仍不可派
    assert ds.release_accepted_downstream(555) == 0
    assert ds._all_prereqs_accepted([A], ds._load_accepted_task_ids(db_session, [A, B])) is False

    # ③ A 返工完成:l2 success + reported
    l2.run_status = "success"; l2.reported_at = cst_now(); db_session.commit()
    # 再评审接受 → 放行对账盖 l2.qa_accepted_at
    assert ds.release_accepted_downstream(555) == 1
    db_session.expire_all()
    # 现在 B 的前置(A)已接受 → 可派
    assert ds._all_prereqs_accepted([A], ds._load_accepted_task_ids(db_session, [A, B])) is True
    # 被接受的是返工后的 l2(不是被否决的 l1)
    assert db_session.get(TaskExecutionLog, l2.id).qa_accepted_at is not None
    assert db_session.get(TaskExecutionLog, l1.id).qa_accepted_at is None
```

- [ ] **Step 2: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_dag_gating.py::test_scenario_b_downstream_gated_until_rework_accepted -v`
Expected: PASS

- [ ] **Step 3: 全量基线**

Run: `cd apps/server && uv run pytest -q`
Expected: 5 failed / 589 passed（+1），零新增。

- [ ] **Step 4: Commit**

```bash
git add apps/server/tests/test_orchestrator_dag_gating.py
git commit -m "test(orchestrator): 情景B集成回归(下游门控至返工接受)"
```

- [ ] **Step 5: 人工冒烟（手测，非自动）**

派"热搜→生成 Word"两步任务，故意让热搜第一版不达标：确认 ① 热搜被打回返工期间，Word **不**开跑（不再先于热搜交付）；② 热搜返工被接受后，Word 才开跑、且基于返工后的好热搜；③ 热搜一次通过时，Word 在热搜被接受后开跑（多等一个评审延迟属预期）。

---

## 风险与注意
- **`get_session_local` 须模块级可见**（Task 3 必做前置）：提到 dependency_scheduler 顶部 import 并删除 `on_employee_task_completed:276` 内的局部 import；否则 `monkeypatch.setattr(ds, "get_session_local", ...)` 命不中、测试静默走生产库。
- **放行对账 `db.close()` 关到 fixture session**（Task 3/5 测试）：monkeypatch 让 `get_session_local()()` 返回 `db_session`，函数末 `db.close()` 会关它——但 SQLite StaticPool 下连接仍活，测试用 `db_session.expire_all()` + `db_session.get(...)` 重读即可（与 QA-rework Task 2 已验证的同款边界一致）。
- **放行对账调 `on_employee_task_completed` 的重入**：放行→派下游→下游完成→评审→放行……每次接受一次性（qa_accepted_at），无环。
- **capacity/slot 跳过非卡死**：放行时下游员工满载则 `continue`，待下个员工流结束重评估（既有重试链路）。
- **重启打断返工**不在本特性兜底范围（→ 既有失败级联跳过，非死锁），见 spec §4.4。
- **`db_session` fixture**：用现有 conftest；若 fixture 名/工厂不同按现状调整 seed helper。

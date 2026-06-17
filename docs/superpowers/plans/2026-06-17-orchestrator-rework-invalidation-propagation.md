# 返工作废传播 + 返工 gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让返工打通 DAG——返工某任务前要求其前置已 QA 接受;返工一个任务时递归作废其下游子树,下游在该任务重新达标后由现有放行闸自动重跑,从而与次序无关地消除"下游基于被返工上游的旧数据跑/交付"。

**Architecture:** 两个新 graph 函数置于 `dependency_scheduler.py`(`task_prereqs_accepted` 读检查、`invalidate_downstream` 传递闭包作废+取消在飞);接到 `rework.py` 的 `redispatch_task_in_session`(起流前 gate、打回起流后 invalidate);复用 `superseded` 状态、`build_dependency_maps` 的 successors、`_load_accepted_task_ids`/`_all_prereqs_accepted`、放行闸、`ChatService.cancel_conversation_stream`。纯后端。

**Tech Stack:** Python FastAPI + SQLAlchemy(`uv`)、LangChain `@tool`。

**关联 spec:** [docs/superpowers/specs/2026-06-17-orchestrator-rework-invalidation-propagation-design.md](../specs/2026-06-17-orchestrator-rework-invalidation-propagation-design.md)

**基线(改动后零新增失败):** 后端 `cd apps/server && uv run pytest -q` → 5 failed / 589 passed。前端不动。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/server/src/service/agent/orchestrator/dependency_scheduler.py` | `task_prereqs_accepted` + `invalidate_downstream` | Modify |
| `apps/server/src/service/agent/orchestrator/rework.py` | `redispatch_task_in_session` 接 gate + invalidate | Modify |
| `apps/server/src/service/agent/orchestrator/prompts.py` | 返工只针对单任务/下游自动重跑 的 prompt | Modify |
| `apps/server/tests/test_orchestrator_rework_invalidation.py` | 新功能单测 + 集成回归 | Create |
| `apps/server/tests/test_prompt_invariants.py` | 新增锚点断言 | Modify |

**接地事实(已读码确认):**
- `build_dependency_maps(tasks, plan_json_obj) -> (dep_map, successors)`:`dep_map[task.id]`=前置 id 列表;`successors[task.id]`=依赖它的后继 id 列表。
- `_load_plan_tasks(db, plan_id)`、`_load_accepted_task_ids(db, ids)`、`_all_prereqs_accepted(dep_ids, accepted_ids)`、`get_session_local`、`select`、`json`、`logger` 均在 dependency_scheduler 模块顶/模块内可用。
- `_ALREADY_DISPATCHED_STATES` **不含** `superseded`(作废后可重派)。
- `_finalize_task_stream`(stream_registry.py:2352-2357)只更新 `run_status IN ("running","queued")` 的 log → 先标 superseded 即 no-op。
- `ChatService.cancel_conversation_stream(conversation_id)`(chat_service.py:1140)。
- `redispatch_task_in_session`(rework.py:60):in-flight 守卫在 ~line 101-105;打回旧 log 在 ~line 108;`db.commit()` 在 ~line 144;`_schedule_employee_rework_stream` 在 ~line 148;`WorkspaceEventBus.push` 在 ~line 156-167。

---

## Task 1: graph 函数 `task_prereqs_accepted` + `invalidate_downstream`

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/dependency_scheduler.py`(加两函数,置于 `_all_prereqs_accepted` 之后)
- Test: `apps/server/tests/test_orchestrator_rework_invalidation.py`(Create)

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_orchestrator_rework_invalidation.py
import json
from sqlalchemy import select
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.conversation import Conversation
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now


class _NoCloseSession:
    """db_session 透明代理,屏蔽 close()——防自管 session 的函数把 fixture session 关掉。"""
    def __init__(self, real): self._real = real
    def close(self): pass
    def __getattr__(self, name): return getattr(self._real, name)


def _seed_plan_AB(db, *, dep=True):
    """建计划:A(根) → B(依赖A)。返回 (ws, emp, plan, A, B)。dep=False 则 B 无依赖。"""
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db.add(emp); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=555, status="confirmed", plan_json="[]")
    db.add(plan); db.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A", orchestration_plan_id=plan.id)
    db.add(A); db.flush()
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B", orchestration_plan_id=plan.id)
    db.add(B); db.flush()
    # plan_json 按任务创建顺序(id 升序)对应下标:[A, B]；B.depends_on=0(=A)
    plan.plan_json = json.dumps([{"depends_on": None}, {"depends_on": 0 if dep else None}])
    db.commit()
    return ws, emp, plan, A, B


def _seed_log(db, *, task, ws_id, emp_id, run_status="success", reported=True, accepted=False):
    log = TaskExecutionLog(
        task_id=task.id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot=task.task_name, run_status=run_status, run_result="r",
        input_json="{}", output_json="{}",
        conversation_id=None, orchestrator_conversation_id=555,
        started_at=cst_now(), ended_at=cst_now(),
        reported_at=cst_now() if reported else None,
        qa_accepted_at=cst_now() if accepted else None,
    )
    db.add(log); db.commit()
    return log


def test_task_prereqs_accepted(db_session):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    # A 未接受 → B 的前置未接受
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, accepted=False)
    assert ds.task_prereqs_accepted(db_session, B) is False
    # 根任务 A 无前置 → True
    assert ds.task_prereqs_accepted(db_session, A) is True
    # A 接受后 → B 的前置已接受
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, accepted=True)
    assert ds.task_prereqs_accepted(db_session, B) is True


def test_invalidate_downstream_supersedes_delivered(db_session, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    out = ds.invalidate_downstream(A.id)  # 作废 A 的下游(B)
    assert out == [B.id]
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"
    # 作废后 B 可再派(superseded 不在 already_dispatched)
    sset = ds._log_status_by_task(db_session, [B.id])
    assert ds._already_dispatched(B.id, sset) is False


def test_invalidate_downstream_cancels_inflight(db_session, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    cancelled = []
    # cancel 在 ChatService 上,patch 它
    from src.service.chat_service import ChatService
    monkeypatch.setattr(ChatService, "cancel_conversation_stream", staticmethod(lambda cid: cancelled.append(cid) or True))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="running", reported=False)
    bl.conversation_id = 4242; db_session.commit()
    out = ds.invalidate_downstream(A.id)
    assert out == [B.id]
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"
    assert cancelled == [4242]  # 取消了在飞下游的流


def test_invalidate_downstream_skips_failed(db_session, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="failed", reported=False)
    out = ds.invalidate_downstream(A.id)
    assert out == []  # failed 下游不动(非目标)
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "failed"
```

> NOTE: 若 `OrchestrationPlan` / `Workspace` / `Employee` 构造所需非空字段与上不符,按真实模型最小调整 seed(保持测试意图)。`db_session` fixture 见 conftest。

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework_invalidation.py -k "prereqs or invalidate" -v`
Expected: FAIL(函数不存在)

- [ ] **Step 3: 实现两函数**

`dependency_scheduler.py` 在 `_all_prereqs_accepted` 之后加:

```python
def task_prereqs_accepted(db: Session, task) -> bool:
    """该任务的所有前置是否都已 QA 接受(根任务无前置 → True)。返工 gate 用。"""
    from src.models.orchestration_plan import OrchestrationPlan

    if task.orchestration_plan_id is None:
        return True
    plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
    if plan is None:
        return True
    tasks = _load_plan_tasks(db, plan.id)
    plan_json_obj = json.loads(plan.plan_json or "[]")
    dep_map, _successors = build_dependency_maps(tasks, plan_json_obj)
    dep_ids = dep_map.get(task.id, [])
    if not dep_ids:
        return True
    return _all_prereqs_accepted(dep_ids, _load_accepted_task_ids(db, dep_ids))


def invalidate_downstream(task_id: int) -> list[int]:
    """返工 task_id 时,递归作废其下游子树(传递闭包):
    已交付(success/completed)→ superseded;在飞(running/queued/pending)→ 先 superseded
    并 commit、再取消其流。failed/skipped/superseded 不动(非目标)。返回被作废的 task_id。
    自管独立 session(在调用方 rework.py 自己 commit 之后调,读到已提交状态)。"""
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.chat_service import ChatService

    db = get_session_local()()
    try:
        task = db.get(EmployeeTask, task_id)
        if task is None or task.orchestration_plan_id is None:
            return []
        plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
        if plan is None:
            return []
        tasks = _load_plan_tasks(db, plan.id)
        plan_json_obj = json.loads(plan.plan_json or "[]")
        _dep_map, successors = build_dependency_maps(tasks, plan_json_obj)

        invalidated: list[int] = []
        seen: set[int] = set()
        queue: list[int] = list(successors.get(task_id, []))
        while queue:
            cid = queue.pop(0)
            if cid in seen:
                continue
            seen.add(cid)
            queue.extend(successors.get(cid, []))  # 传递闭包(seen 防环)
            log = db.scalars(
                select(TaskExecutionLog)
                .where(TaskExecutionLog.task_id == cid)
                .order_by(TaskExecutionLog.id.desc())
            ).first()
            if log is None:
                continue  # 从未派/无 log → 无可作废
            if log.run_status in ("success", "completed"):
                log.run_status = "superseded"
                log.run_result = "上游返工，已作废待重跑"
                db.commit()
                invalidated.append(cid)
            elif log.run_status in ("running", "queued", "pending"):
                conv_id = log.conversation_id
                # 次序关键:先落 superseded(commit)再取消,使异步取消善后 no-op(见 spec §6)
                log.run_status = "superseded"
                log.run_result = "上游返工，已作废待重跑"
                db.commit()
                if conv_id:
                    try:
                        ChatService.cancel_conversation_stream(conv_id)
                    except Exception:
                        logger.warning("cancel in-flight downstream conv=%s failed", conv_id, exc_info=True)
                invalidated.append(cid)
            # superseded/failed/skipped: 不动(非 live / 非目标)
        if invalidated:
            logger.info("invalidate_downstream task=%s invalidated=%s", task_id, invalidated)
        return invalidated
    finally:
        db.close()
```

- [ ] **Step 4: 跑确认通过 + 全量**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework_invalidation.py -v && uv run pytest -q`
Expected: 4 新测试 PASS;全量 5 failed / 593 passed(+4),零新增。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/dependency_scheduler.py apps/server/tests/test_orchestrator_rework_invalidation.py
git commit -m "feat(orchestrator): 返工 graph 函数(前置接受检查 + 下游作废传播)"
```

---

## Task 2: 接到 rework.py(gate + invalidate)

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/rework.py`(`redispatch_task_in_session`)
- Test: `apps/server/tests/test_orchestrator_rework_invalidation.py`(append)

- [ ] **Step 1: 写失败测试**

```python
def test_redispatch_refuses_when_prereq_not_accepted(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    # A 未接受;B 已交付待返工
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, accepted=False)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success")
    bl.conversation_id = 9; db_session.commit()
    msg = rework.redispatch_task_in_session(ws.id, B.id, "改B")
    assert "前置" in msg  # 拒绝
    db_session.expire_all()
    # 未消耗 rework_count、未打回 B
    assert db_session.get(EmployeeTask, B.id).rework_count == 0
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "success"


def test_redispatch_invalidates_downstream(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    al = _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    al.conversation_id = 7; db_session.commit()
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    # 返工 A(根,前置 gate 通过)→ 应打回 A 并作废下游 B
    msg = rework.redispatch_task_in_session(ws.id, A.id, "改A")
    assert "返工" in msg or "打回" in msg
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"  # B 被作废
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework_invalidation.py -k "refuses or invalidates_downstream" -v`
Expected: FAIL

- [ ] **Step 3: 接 gate + invalidate**

在 `rework.py` `redispatch_task_in_session`:

(a) **gate**——在 in-flight 守卫(`if old.run_status in ("running","queued","pending")` 那段)**之后**、`# 1) 打回旧 log` **之前**插入:
```python
        # gate：前置未通过质检/正在返工 → 拒绝(不消耗 rework_count、不打回)
        from src.service.agent.orchestrator.dependency_scheduler import task_prereqs_accepted
        if not task_prereqs_accepted(db, task):
            return (
                f"错误：任务「{task.task_name}」的前置尚未通过质检（或正在返工），"
                f"无法返工它；请先处理前置——其下游会在前置重新达标后自动重跑。"
            )
```

(b) **invalidate**——在 `WorkspaceEventBus.push(...)` 那段**之后**、`return ...` **之前**插入(此时 rework 自己的 `db.commit()` 已执行,X 打回已落库):
```python
        # 作废 X 的下游子树(它们基于旧产物的结果已失效)→ 待 X 重新达标后由放行闸自动重跑
        try:
            from src.service.agent.orchestrator.dependency_scheduler import invalidate_downstream
            invalidate_downstream(task.id)
        except Exception:
            logger.warning("invalidate_downstream task=%s failed", task.id, exc_info=True)
```

- [ ] **Step 4: 跑确认通过 + 全量**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework_invalidation.py -v && uv run pytest -q`
Expected: 新测试 PASS;全量 5 failed / 595 passed(+2),零新增。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/rework.py apps/server/tests/test_orchestrator_rework_invalidation.py
git commit -m "feat(orchestrator): 返工接 gate(前置未接受拒绝) + 作废下游"
```

---

## Task 3: prompt(返工只针对单任务/下游自动重跑)

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py`(「一线质检」段,~line 79-86 那条 bullet 群之后)
- Modify: `apps/server/tests/test_prompt_invariants.py`(总管段加断言)

- [ ] **Step 1: 写不变量断言(先失败)**

```python
# test_prompt_invariants.py 追加(总管段)
def test_orchestrator_rework_single_task_rule(orchestrator_prompt: str) -> None:
    """返工只针对出问题的单任务、下游自动重跑的指引不可丢。"""
    assert "作废" in orchestrator_prompt
    assert "下游" in orchestrator_prompt
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_prompt_invariants.py::test_orchestrator_rework_single_task_rule -v`
Expected: FAIL

- [ ] **Step 3: 改 prompt**

在「一线质检」相关段(`redispatch_task` 那条 bullet)末尾追加一句:
```
- **返工只针对出问题的那个任务**：返工一个任务会**自动作废并重跑它的所有下游**（下游基于旧产物的结果已失效）——**不要手动返工下游**，它会在该任务重新达标后自动重跑、再交你评审。若你要返工的任务其前置尚未达标/在返工，系统会拒绝（先处理前置）。
```

- [ ] **Step 4: 跑确认通过(全不变量门)**

Run: `cd apps/server && uv run pytest tests/test_prompt_invariants.py -q`
Expected: 全绿(含新断言)。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_prompt_invariants.py
git commit -m "feat(orchestrator): prompt 告知返工只针对单任务、下游自动作废重跑"
```

---

## Task 4: 集成回归(两序) + 端到端自检

**Files:**
- Test: `apps/server/tests/test_orchestrator_rework_invalidation.py`(append)

- [ ] **Step 1: 写两序集成测试**

```python
def test_both_orderings_converge(db_session, monkeypatch):
    """两序都收敛到'B 不会与 A 并行用旧数据返工'。
    先A后B:返工A作废B,再返工B被gate拒。
    先B后A:返工B起流(占位),再返工A作废并取消B在飞返工。"""
    from src.service.agent.orchestrator import rework
    from src.service.agent.orchestrator import dependency_scheduler as ds
    from src.service.chat_service import ChatService
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    cancelled = []
    monkeypatch.setattr(ChatService, "cancel_conversation_stream",
                        staticmethod(lambda cid: cancelled.append(cid) or True))

    # ---- 先 A 后 B ----
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    al = _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    al.conversation_id = 1; db_session.commit()
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    bl.conversation_id = 2; db_session.commit()
    rework.redispatch_task_in_session(ws.id, A.id, "改A")        # 返工A → 作废B
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"
    msg_b = rework.redispatch_task_in_session(ws.id, B.id, "改B")  # 再返工B → gate 拒(A不再接受)
    assert "前置" in msg_b


def test_ordering_B_then_A_cancels_inflight(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    from src.service.agent.orchestrator import dependency_scheduler as ds
    from src.service.chat_service import ChatService
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    cancelled = []
    monkeypatch.setattr(ChatService, "cancel_conversation_stream",
                        staticmethod(lambda cid: cancelled.append(cid) or True))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    al = _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    al.conversation_id = 1; db_session.commit()
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    bl.conversation_id = 2; db_session.commit()
    # 先返工 B(A 此刻仍接受 → gate 过)→ B 起返工(新 queued log,同会话)
    rework.redispatch_task_in_session(ws.id, B.id, "改B")
    # 再返工 A → 作废 B 的下游闭包中含 B 自己的在飞返工 → 取消 + superseded
    rework.redispatch_task_in_session(ws.id, A.id, "改A")
    db_session.expire_all()
    # B 最新 log(返工 queued 的那条)被作废
    latest_b = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == B.id).order_by(TaskExecutionLog.id.desc())
    ).first()
    assert latest_b.run_status == "superseded"
    assert 2 in cancelled  # 取消了 B 的在飞返工流(conversation_id=2)
```

> 注:`_schedule_employee_rework_stream` 被 patch 成 no-op,故 B 返工"起流"只落 queued log(同会话 id=2)。"先B后A"时 A 作废 B 的最新(queued)log + 取消其 conversation。

- [ ] **Step 2: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework_invalidation.py -k "orderings or B_then_A" -v`
Expected: PASS

- [ ] **Step 3: 全量基线**

Run: `cd apps/server && uv run pytest -q`
Expected: 5 failed / 597 passed(+2),零新增。

- [ ] **Step 4: Commit**

```bash
git add apps/server/tests/test_orchestrator_rework_invalidation.py
git commit -m "test(orchestrator): 返工作废传播两序集成回归"
```

- [ ] **Step 5: 人工冒烟(手测,非自动)**

复现上次:派 A→B 串行,**故意让 A、B 都不达标**。确认:① 返工 A 时 B 自动作废、不再与 A 并行用旧数据返工;② A 返工达标被接受后,B 自动重跑、基于返工后的 A 数据;③ 总管不再同轮硬塞两个返工(prompt 生效)。多跑几次确认偶发不再出现。

---

## 风险与注意
- **`get_session_local` 须模块级可见**(已于 DAG-QA gating 提到 dependency_scheduler 顶);测试 monkeypatch `ds.get_session_local`。
- **`invalidate_downstream` 自管 session**:在 rework.py 自己 `db.commit()` 之后调,读已提交状态;`_NoCloseSession` 代理避免关掉 fixture session。
- **取消在飞次序**:先 superseded+commit 再 cancel(finalize 只动 running/queued → no-op)。
- **gate 位置**:必须在打回/计数**之前**,拒绝零副作用。
- **`OrchestrationPlan` 构造字段**:seed 若与真实模型非空约束不符,最小调整(plan_json 下标须与任务 id 升序一致)。
- **失败/跳过下游不重跑**(非目标,spec §2)。

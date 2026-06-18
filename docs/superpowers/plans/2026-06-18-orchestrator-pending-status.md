# 总管「待放行/等待前置」状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给总管对编排计划内未派任务显示「待放行/等待前置/待派发」状态(替代裸「未执行」),让它不再把"等放行"误读成"卡住"而抢活。

**Architecture:** 新增只读 helper `waiting_status_for_task`(据 DAG dep_map + 已接受集判);接到两个显示面——list_tasks 工具的无-log 兜底、整盘快照 `build_delegation_execution_context` 的"待派发段";顺带对齐 prompt 一句措辞。纯后端只读,不碰派发/放行/前端。

**Tech Stack:** Python FastAPI + SQLAlchemy(`uv`)。

**关联 spec:** [docs/superpowers/specs/2026-06-18-orchestrator-pending-status-design.md](../specs/2026-06-18-orchestrator-pending-status-design.md)

**基线(改后零新增失败):** `cd apps/server && uv run pytest -q` → 5 failed / 当前 passed 数;前端不动。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/server/src/service/agent/orchestrator/dependency_scheduler.py` | `waiting_status_for_task` | Modify |
| `apps/server/src/service/agent/orchestrator/task_listing.py` | 无-log 兜底接 helper | Modify |
| `apps/server/src/service/agent/orchestrator/prompts.py` | 快照"待派发段" + 措辞对齐 | Modify |
| `apps/server/tests/test_pending_status.py` | helper + 快照测试 | Create |

**接地事实(已核实):**
- `build_dependency_maps(tasks, plan_json_obj)->(dep_map,successors)`、`_load_plan_tasks(db,plan_id)`、`_load_accepted_task_ids(db,ids)` 均在 dependency_scheduler;`json/select/get_session_local` 模块顶已 import。
- `OrchestrationPlan`:`conversation_id`/`status`/`plan_json`/`created_at`;`EmployeeTask.orchestration_plan_id`。
- `task_listing.py:196-200` 兜底:`latest_log.run_status if latest_log else ("运行中" if scheduled else "未执行")`;循环变量 `t`(EmployeeTask)、`db` 在作用域。
- `build_delegation_execution_context(db, workspace_id, orchestrator_conversation_id, *, limit=10, ...)`:开头 `if not logs: return "（…尚未委派…）"`;之后遍历 `logs` 建 per-log 段;末 `return "\n".join(lines).strip()`。

---

## Task 1: helper `waiting_status_for_task`

**Files:** Modify `dependency_scheduler.py`(置于 `_load_accepted_task_ids`/`_all_prereqs_accepted` 之后);Create `tests/test_pending_status.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_pending_status.py
import json
from src.models.workspace import Workspace
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.conversation import Conversation, ConversationMessage
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now


def _seed_plan_AB(db, *, conv_id=555):
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db.add(emp); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=conv_id, status="confirmed",
                             plan_json="[]", user_input="(t)")
    db.add(plan); db.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="热搜聚合", orchestration_plan_id=plan.id)
    db.add(A); db.flush()
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="文档办公", orchestration_plan_id=plan.id)
    db.add(B); db.flush()
    plan.plan_json = json.dumps([{"depends_on": None}, {"depends_on": 0}])  # B 依赖 A
    db.commit()
    return ws, emp, plan, A, B


def _accept_log(db, *, task, ws_id, emp_id):
    log = TaskExecutionLog(
        task_id=task.id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot=task.task_name, run_status="success", run_result="r",
        input_json="{}", output_json="{}", conversation_id=None,
        orchestrator_conversation_id=555, started_at=cst_now(), ended_at=cst_now(),
        reported_at=cst_now(), qa_accepted_at=cst_now(),
    )
    db.add(log); db.commit()
    return log


def test_waiting_status_pending_release(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import waiting_status_for_task
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    _accept_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id)  # A 已接受
    assert waiting_status_for_task(db_session, B) == "待放行"


def test_waiting_status_waiting_prereq(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import waiting_status_for_task
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    # A 未接受 → B 等待前置「热搜聚合」
    s = waiting_status_for_task(db_session, B)
    assert s is not None and "等待前置" in s and "热搜聚合" in s


def test_waiting_status_root_and_nonplan(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import waiting_status_for_task
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    assert waiting_status_for_task(db_session, A) == "待派发"  # 根任务无前置
    orphan = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="x", orchestration_plan_id=None)
    db_session.add(orphan); db_session.commit()
    assert waiting_status_for_task(db_session, orphan) is None  # 非计划任务
```

- [ ] **Step 2: 跑确认失败** `cd apps/server && uv run pytest tests/test_pending_status.py -v` → FAIL

- [ ] **Step 3: 实现**(dependency_scheduler.py，`_all_prereqs_accepted` 之后):
```python
def waiting_status_for_task(db: Session, task, *, _plan_cache: dict | None = None) -> str | None:
    """编排计划内、当前无 live log 的任务"为何没动"的可读状态。非计划任务 → None。
    待放行(前置全 QA 接受) / 等待前置「X」(前置未接受) / 待派发(根任务无前置)。纯只读。
    _plan_cache：调用方可传 {} 跨多任务复用同一 plan 的 dep_map/accepted，避免重复加载。"""
    from src.models.orchestration_plan import OrchestrationPlan

    plan_id = getattr(task, "orchestration_plan_id", None)
    if plan_id is None:
        return None
    cache = _plan_cache if _plan_cache is not None else {}
    if plan_id not in cache:
        plan = db.get(OrchestrationPlan, plan_id)
        if plan is None:
            cache[plan_id] = None
        else:
            ptasks = _load_plan_tasks(db, plan_id)
            dep_map, _succ = build_dependency_maps(ptasks, json.loads(plan.plan_json or "[]"))
            accepted = _load_accepted_task_ids(db, [t.id for t in ptasks])
            cache[plan_id] = (dep_map, accepted, {t.id: t for t in ptasks})
    entry = cache[plan_id]
    if entry is None:
        return None
    dep_map, accepted, by_id = entry
    dep_ids = dep_map.get(task.id, [])
    if not dep_ids:
        return "待派发"
    if all(d in accepted for d in dep_ids):
        return "待放行"
    pending = [by_id[d].task_name for d in dep_ids if d not in accepted and d in by_id]
    if pending:
        return f"等待前置「{pending[0]}」" + ("等" if len(pending) > 1 else "")
    return "等待前置"
```

- [ ] **Step 4: 跑通过 + 全量** `cd apps/server && uv run pytest tests/test_pending_status.py -v && uv run pytest -q`（新 3 测试 PASS；全量零新增）

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/service/agent/orchestrator/dependency_scheduler.py apps/server/tests/test_pending_status.py
git commit -m "feat(orchestrator): waiting_status_for_task(据DAG算待放行/等待前置)"
```

---

## Task 2: list_tasks 无-log 兜底接 helper

**Files:** Modify `task_listing.py`(状态兜底 ~196-200)

- [ ] **Step 1: 改兜底**

把 `for t in tasks:` 循环**之前**加缓存 `_pending_cache: dict = {}`。把状态兜底改为：
```python
        if latest_log:
            task_status = latest_log.run_status
        elif t.execute_mode == "scheduled":
            task_status = "运行中"
        else:
            from src.service.agent.orchestrator.dependency_scheduler import (
                waiting_status_for_task,
            )
            task_status = (
                waiting_status_for_task(db, t, _plan_cache=_pending_cache) or "未执行"
            )
```
（scheduled 不调 helper；无-log 非定时才算待放行；helper 返 None 回落「未执行」。`_plan_cache` 跨循环复用。）

- [ ] **Step 2: 验证**

无独立单测(list_tasks 输出格式化函数,集成在 Task 3 的快照测试旁验证即可);先静态确保导入不破:
`cd apps/server && uv run python -c "import src.service.agent.orchestrator.task_listing; print('OK')"`
并跑全量确保无回归:`cd apps/server && uv run pytest -q`（零新增失败）。

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/service/agent/orchestrator/task_listing.py
git commit -m "feat(orchestrator): list_tasks 无-log 计划任务显示待放行/等待前置"
```

---

## Task 3: 整盘快照"待派发段" + prompt 措辞

**Files:** Modify `prompts.py`(`build_delegation_execution_context` + 模板第 89 行);`tests/test_pending_status.py`(append)

- [ ] **Step 1: 写失败测试**

```python
def test_snapshot_shows_pending_release_section(db_session):
    from src.service.agent.orchestrator.prompts import build_delegation_execution_context
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    _accept_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id)  # A 有 log+接受;B 无 log
    text = build_delegation_execution_context(db_session, ws.id, 555)
    assert "待放行" in text and "文档办公" in text  # B 作为待派发出现、状态待放行
    # A 已 logged,不应在待派发段重复(它在 per-log 段)
```

- [ ] **Step 2: 跑确认失败** `-k snapshot_shows_pending` → FAIL

- [ ] **Step 3: 实现 build_delegation_execution_context**

(a) **放宽早返回**：把开头
```python
    if not logs:
        return "（本会话尚未委派任何子任务，或无执行记录）"
```
改为：先不返回——把 logs 段与待派发段都构建,末尾若两者皆空才回落该文案。最简改法:删掉这个早返回,在函数末尾判断 `lines` 是否只有引导头(无实质内容)→ 回落。**实现期保证:零 log 且无活跃计划未派任务时仍回落原文案。**

(b) **遍历 logs 后**,记 `logged_ids = {log.task_id for log in logs if log.task_id}`,追加待派发段:
```python
    # 待派发/等待中：当前活跃计划里尚无 live log 的任务(让总管看到完整 DAG,不误判"卡住")
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.agent.orchestrator.dependency_scheduler import (
        _load_plan_tasks, waiting_status_for_task,
    )
    plan = db.scalars(
        select(OrchestrationPlan)
        .where(
            OrchestrationPlan.conversation_id == orchestrator_conversation_id,
            OrchestrationPlan.status.notin_(("completed", "cancelled")),
        )
        .order_by(OrchestrationPlan.id.desc())
    ).first()
    if plan is not None:
        pending_lines: list[str] = []
        cache: dict = {}
        for t in _load_plan_tasks(db, plan.id):
            if t.id in logged_ids:
                continue
            st = waiting_status_for_task(db, t, _plan_cache=cache)
            if st:
                pending_lines.append(f"- {t.task_name} · **{st}**")
        if pending_lines:
            lines.append("### 待派发/等待中的子任务（系统会在其前置达标后自动放行，无需你催派）")
            lines.extend(pending_lines)
            lines.append("")
```
（`select` 已在 prompts.py 顶 import；`OrchestrationPlan` 函数内 import。）

(c) **末尾回落**：`result = "\n".join(lines).strip()`；若 `not logs and not pending_lines`(或 result 仅剩引导头)→ `return "（本会话尚未委派任何子任务，或无执行记录）"`，否则 `return result`。

- [ ] **Step 4: prompt 措辞对齐**

`prompts.py` 模板第 89 行：把「…所以下游显示「未执行」是正常的…」中的 **"下游显示「未执行」是正常的"** 改为 **"下游显示「待放行」是正常的（它会在你收尾后自动开始）"**。**只换这半句**,保留同段「别 panic / 别 update_task」与第 90 行「绝不复述给用户」。

- [ ] **Step 5: 跑通过 + 不变量门 + 全量**

`cd apps/server && uv run pytest tests/test_pending_status.py -v`（含 snapshot 测试）
`cd apps/server && uv run pytest tests/test_prompt_invariants.py -q`（措辞改动不破断言）
`cd apps/server && uv run pytest -q`（全量零新增）

- [ ] **Step 6: Commit**
```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_pending_status.py
git commit -m "feat(orchestrator): 快照补待派发段(待放行/等待前置) + prompt措辞对齐"
```

- [ ] **Step 7: 人工冒烟(手测,非自动)**

派"热搜→文档"两步。在热搜达标、文档待放行那一刻:list_tasks / 总管正文应显示文档为**「待放行」**(而非「未执行」)→ 确认总管不再 panic 写脚本抢活、正常收尾让系统放行。

---

## 风险与注意
- **活跃计划选择**：用 `status not in (completed, cancelled)` + `id desc` 取当前计划,避免列历史计划任务(评审 Issue 1)。
- **不重复列**：`t.id in logged_ids` 跳过(评审 Issue 2),已有 log 的任务只在 per-log 段出现。
- **放宽早返回**：零 log 但有待派发任务时,快照仍要显示待派发段(评审 Issue 3);两者皆空才回落原文案。
- **`db_session` fixture**:用现有 conftest;若模型构造缺非空字段,最小调整 seed(OrchestrationPlan.user_input 必给)。
- **纯只读**:不碰派发/放行/前端;前端不动。

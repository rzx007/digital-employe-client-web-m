# 总管一线质检 + 自主透明返工 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让总管对员工交付做一线质检——对照派活契约「输出」判定达标/不达标，不达标时在**同一员工对话续聊**自主返工（透明告知领导、次数硬上限），人类领导仍做最终验收。

**Architecture:** 全部挂在已有缝上：返工执行复用「等总管 idle → 起员工流」的 `_start_employee_stream_when_orchestrator_idle`，返工循环复用 `trigger_incremental_report` 增量引擎（`reported_at` 幂等）。新增一个工具 `redispatch_task`、一条「现有对话续聊」派发路径、`EmployeeTask.rework_count` 列、`superseded`（打回）状态，以及总管 prompt 的「一线质检」段。

**Tech Stack:** Python FastAPI + SQLAlchemy（`uv`）、LangChain `@tool`、React 19 + TS（前端可见性）。

**关联 spec：** [docs/superpowers/specs/2026-06-16-orchestrator-qa-rework-design.md](../specs/2026-06-16-orchestrator-qa-rework-design.md)

**基线（改动后须零新增失败）：**
- 后端：`cd apps/server && uv run pytest -q` → 5 failed / 573 passed
- 前端 typecheck：`cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → 90 errors
- 前端 vitest：`cd apps/web && npx vitest run` → 1 failed（resolve-workbench-curator-panel）
- prompt 不变量门：`cd apps/server && uv run pytest -q tests/test_prompt_invariants.py` → 全绿

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/server/src/models/employee_task.py` | EmployeeTask 加 `rework_count` | Modify |
| `apps/server/src/db/init_db.py` | `rework_count` ensure_column 迁移 | Modify |
| `apps/server/src/service/agent/orchestrator/rework.py` | 返工编排核心 + 续聊派发路径 + `MAX_REWORK` | Create |
| `apps/server/src/service/agent/orchestrator/tools/tasks.py` | `@tool redispatch_task` | Modify |
| `apps/server/src/service/agent/orchestrator/tools/__init__.py` | 注册 redispatch_task | Modify |
| `apps/server/src/service/agent/orchestrator/agent.py` | 序列化进总管工具表 | Modify |
| `apps/server/src/service/agent/orchestrator/prompts.py` | 一线质检 prompt 段 + 评审注入原契约 + superseded 标签 | Modify |
| `apps/server/src/service/task_service.py` | list_execution_logs 给每条 log 附 `rework_count` | Modify |
| `apps/server/src/schemas/task.py` + `api/task_api.py` | TaskExecutionLogRead 暴露 `rework_count` | Modify |
| `apps/web/src/types/schedule-monitor.ts` | `rework_count` + `superseded` 状态 | Modify |
| `apps/web/src/components/chat/message-blocks/execution-report-card.tsx` | 「打回 / 返工 N 次」渲染 | Modify |
| `tests/test_orchestrator_rework.py` | 返工编排单测 | Create |

---

## Task 1: `rework_count` 列 + 迁移

**Files:**
- Modify: `apps/server/src/models/employee_task.py`（EmployeeTask 字段区，~line 40 末尾）
- Modify: `apps/server/src/db/init_db.py:42-56`（employee_tasks 的 ensure_column 群）
- Test: `apps/server/tests/test_orchestrator_rework.py`（Create）

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_orchestrator_rework.py
from src.models.employee_task import EmployeeTask


def test_employee_task_has_rework_count_default_zero():
    t = EmployeeTask(workspace_id=1, employee_id=1, task_name="x")
    assert t.rework_count == 0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py::test_employee_task_has_rework_count_default_zero -v`
Expected: FAIL（`rework_count` 属性不存在 / 为 None）

- [ ] **Step 3: 模型加列**

`employee_task.py` 在 `updated_at` 之前加：
```python
    rework_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
```

- [ ] **Step 4: init_db 加迁移**

`init_db.py` 在 employee_tasks 的 ensure_column 群里加：
```python
    ensure_column("employee_tasks", "rework_count", "rework_count INTEGER NOT NULL DEFAULT 0")
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py::test_employee_task_has_rework_count_default_zero -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/models/employee_task.py apps/server/src/db/init_db.py apps/server/tests/test_orchestrator_rework.py
git commit -m "feat(orchestrator): EmployeeTask.rework_count 列 + 迁移"
```

---

## Task 2: 返工编排核心 `rework.py`（续聊派发 + 上限 + superseded）

**说明：** 这是计划的核心。仿 `reentry.py` 的可 monkeypatch 缝设计——把真正"起员工流"的动作抽成一个模块级函数，测试时替换它，从而只断言 DB 编排（旧 log 转 superseded / 建新 log 同 conversation / rework_count+1 / 上限拒绝），不触真实流。

**Files:**
- Create: `apps/server/src/service/agent/orchestrator/rework.py`
- Test: `apps/server/tests/test_orchestrator_rework.py`（续）

参考现有：`execution.py:start_task_as_conversation`（建 log+agent、`_start_employee_stream_when_orchestrator_idle` 起流、`get_agent` 构建、共享桌解析）、`reentry.py`（fresh session + 可 patch 缝 + `get_main_loop().call_soon_threadsafe`）。

- [ ] **Step 1: 写失败测试（上限拒绝 + 正常返工编排）**

```python
# apps/server/tests/test_orchestrator_rework.py （追加）
import json
import pytest
from sqlalchemy import select
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.conversation import Conversation
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now


def _seed_task_with_settled_log(db, *, rework_count=0, run_status="success"):
    ws = Workspace(name="w"); db.add(ws); db.flush()
    emp = Employee(workspace_id=ws.id, name="员工A"); db.add(emp); db.flush()
    task = EmployeeTask(
        workspace_id=ws.id, employee_id=emp.id, task_name="任务X",
        user_prompt="目标:出榜单 输出:TOP20 表格", rework_count=rework_count,
    )
    db.add(task); db.flush()
    conv = Conversation(workspace_id=ws.id, target_type="employee", target_id=emp.id, title="任务X")
    db.add(conv); db.flush()
    log = TaskExecutionLog(
        task_id=task.id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="任务X", run_status=run_status, run_result="done",
        input_json="{}", output_json=json.dumps({"content": "只有 TOP10"}),
        conversation_id=conv.id, orchestrator_conversation_id=999,
        started_at=cst_now(), ended_at=cst_now(), reported_at=cst_now(),
    )
    db.add(log); db.commit()
    return ws, emp, task, conv, log


def test_redispatch_rejects_when_cap_reached(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    ws, emp, task, conv, log = _seed_task_with_settled_log(
        db_session, rework_count=rework.MAX_REWORK
    )
    msg = rework.redispatch_task_in_session(
        ws.id, task.id, "TOP10 不够，要 TOP20"
    )
    assert "上限" in msg or "定夺" in msg
    # 未建新 log、未改 rework_count、旧 log 未被打回
    logs = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id)
    ).all()
    assert len(logs) == 1
    assert db_session.get(EmployeeTask, task.id).rework_count == rework.MAX_REWORK


def test_redispatch_supersedes_old_and_creates_new_same_conversation(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    captured = {}
    monkeypatch.setattr(
        rework, "_schedule_employee_rework_stream",
        lambda **k: captured.update(k),
    )
    ws, emp, task, conv, old = _seed_task_with_settled_log(db_session)
    msg = rework.redispatch_task_in_session(ws.id, task.id, "TOP10 不够，要 TOP20")
    # 旧 log 转 superseded
    db_session.refresh(old)
    assert old.run_status == "superseded"
    # 新 log：同 task、同 conversation、reported_at 为空、running/queued
    logs = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id).order_by(TaskExecutionLog.id.asc())
    ).all()
    assert len(logs) == 2
    new = logs[-1]
    assert new.conversation_id == conv.id
    assert new.orchestrator_conversation_id == 999
    assert new.reported_at is None
    # rework_count 递增
    assert db_session.get(EmployeeTask, task.id).rework_count == 1
    # 返工说明进入调度（透传给起流缝）
    assert captured.get("conversation_id") == conv.id
```

> 注：`db_session` fixture 见 `tests/conftest.py`（现有）。若现有 fixture 名不同，按其约定调整。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py -v`
Expected: FAIL（`rework` 模块/函数不存在）

- [ ] **Step 3: 写 `rework.py`**

```python
# apps/server/src/service/agent/orchestrator/rework.py
"""总管一线质检的返工编排：在同一员工对话续聊重做（非新建会话）。"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)

MAX_REWORK = 2  # 每个子任务最多自主返工次数；超限升级给领导


def _new_session() -> Session:
    from src.db.session import get_session_local
    return get_session_local()()


def _schedule_employee_rework_stream(
    *, conversation_id: int, agent: Any, messages: list, assistant_msg_id: int,
    orchestrator_conversation_id: int | None, owned_db: Session,
) -> None:
    """把"等总管 idle → 起员工流"投到主事件循环（回调线程无 running loop）。

    复用 execution.py 的 _start_employee_stream_when_orchestrator_idle：
    返工由总管在其汇报 turn 内调用 → 总管流仍 active → 须等其 idle（skip=False）。
    """
    import asyncio
    from src.service.agent.orchestrator.execution import (
        _start_employee_stream_when_orchestrator_idle,
    )
    from src.service.agent.orchestrator.runtime import get_main_loop

    def _do() -> None:
        asyncio.create_task(
            _start_employee_stream_when_orchestrator_idle(
                orchestrator_conversation_id=orchestrator_conversation_id,
                conversation_id=conversation_id,
                agent=agent,
                messages=messages,
                assistant_msg_id=assistant_msg_id,
                source="orchestration_rework",
                skip_orchestrator_wait=False,
            )
        )
    try:
        get_main_loop().call_soon_threadsafe(_do)
    except Exception:
        logger.warning("schedule rework stream failed conv=%s", conversation_id, exc_info=True)


def redispatch_task_in_session(
    workspace_id: int, task_id: int, rework_note: str
) -> str:
    """在独立 session 里编排一次返工：上限校验 → 打回旧 log → 续聊建新 log → 起流。

    返回给总管的自然语言结果（成功告知 / 上限升级提示 / 错误）。
    """
    db = _new_session()
    try:
        task = db.get(EmployeeTask, task_id)
        if task is None or task.workspace_id != workspace_id:
            return f"错误：未找到子任务 #{task_id}。"

        if (task.rework_count or 0) >= MAX_REWORK:
            return (
                f"任务「{task.task_name}」已返工 {task.rework_count} 次仍不达标，"
                f"已达上限。请领导定夺（换人 / 改需求 / 接受现状），我不再自动打回。"
            )

        # 取最新一条已终态 log（=触发本轮评审、已盖 reported_at 的那条）
        old = db.scalars(
            select(TaskExecutionLog)
            .where(TaskExecutionLog.task_id == task_id)
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if old is None or old.conversation_id is None:
            return f"错误：任务「{task.task_name}」无可续聊的员工对话，无法返工。"

        conv = db.get(Conversation, old.conversation_id)
        if conv is None:
            return f"错误：任务「{task.task_name}」的员工对话已不存在，无法返工。"

        employee = db.get(Employee, task.employee_id)
        if employee is None:
            return f"错误：任务「{task.task_name}」的执行员工已不存在。"

        # 1) 打回旧 log（仅展示语义；reported_at 已盖，不会被增量引擎重选）
        old.run_status = "superseded"

        # 2) 现有对话续聊：追加 user(返工说明) + assistant 占位
        from src.service.chat_service import ChatService
        rework_directive = (
            "【系统·返工】总管判定上轮交付不达标，请在你上一稿基础上修改。"
            "不达标的点与改进要求如下，直接产出修订后的最终结果：\n"
            f"{rework_note}"
        )
        ChatService._append_message(
            db, conversation=conv, role="user", content=rework_directive
        )
        assistant_msg = ChatService._append_message(
            db, conversation=conv, role="assistant", content=""
        )
        assistant_msg.stream_state = "queued"

        # 3) 新 TaskExecutionLog：同 task、同 conversation、同 orch 会话
        new_log = TaskExecutionLog(
            task_id=task.id,
            workspace_id=workspace_id,
            employee_id=employee.id,
            skill_id=task.skill_id,
            task_name_snapshot=task.task_name,
            run_status="queued",
            run_result="返工中，等待执行",
            input_json=task.task_input_json or "{}",
            output_json="{}",
            conversation_id=conv.id,
            orchestrator_conversation_id=old.orchestrator_conversation_id,
            started_at=cst_now(),
        )
        db.add(new_log)

        # 4) 计数
        task.rework_count = (task.rework_count or 0) + 1
        db.commit()

        # 5) 构建员工 agent（同会话、同共享桌）并起流
        agent = _build_employee_agent_for_rework(db, task, employee, conv.id)
        owned_db = _new_session()
        _schedule_employee_rework_stream(
            conversation_id=conv.id,
            agent=agent,
            messages=[{"role": "user", "content": rework_directive}],
            assistant_msg_id=assistant_msg.id,
            orchestrator_conversation_id=old.orchestrator_conversation_id,
            owned_db=owned_db,
        )

        from src.service.workspace_events import WorkspaceEventBus
        WorkspaceEventBus.push(workspace_id, {
            "type": "task_started",
            "task_id": task.id,
            "conversation_id": conv.id,
            "employee_id": employee.id,
            "employee_name": employee.name,
            "task_name": task.task_name,
        })
        return (
            f"已判定「{task.task_name}」不达标，打回重做（第 {task.rework_count} 次返工）。"
        )
    finally:
        db.close()


def _build_employee_agent_for_rework(db, task, employee, conversation_id: int):
    """复用 execution.py 的共享桌/技能/档位解析，构建续聊用员工 agent。"""
    from src.core.config import get_settings
    from src.llm.factory import resolve_output_tokens
    from src.service.agent.employee import get_agent
    from src.service.chat_service import ChatService
    from src.service.orchestrator_conversation_links import (
        resolve_orchestrator_conversation_id,
    )

    try:
        skills_path = ChatService.resolve_employee_skills_dir(
            skills_payload=employee.skills_json, employee_id=employee.id,
            employee_name=employee.name, employee_code=employee.employee_code,
        )
    except Exception:
        skills_path = ""
    root_path = get_settings().artifacts_path

    shared_artifacts_dir = None
    shared_workspace_root = None
    orch_conv_id = resolve_orchestrator_conversation_id(db, task)
    if orch_conv_id is not None:
        from src.service.agent.workspace_paths import (
            resolve_orchestrator_desk_dir, orchestrator_task_subdir,
        )
        _desk = resolve_orchestrator_desk_dir(root_path, orch_conv_id)
        shared_artifacts_dir = str(orchestrator_task_subdir(_desk, task.id))
        shared_workspace_root = str(_desk)

    _tier = "standard"
    try:
        _ti = json.loads(task.task_input_json or "{}")
        if isinstance(_ti, dict) and _ti.get("output_tier"):
            _tier = str(_ti["output_tier"])
    except (json.JSONDecodeError, TypeError):
        pass

    return get_agent(
        skills_path, root_path, employee_id=employee.id,
        conversation_id=conversation_id, enable_hitl=False,
        shared_artifacts_dir=shared_artifacts_dir,
        shared_workspace_root=shared_workspace_root,
        max_output_tokens=resolve_output_tokens(_tier),
    )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py -v`
Expected: PASS（两个用例）

- [ ] **Step 5: 全量确认零新增**

Run: `cd apps/server && uv run pytest -q`
Expected: 5 failed / 575 passed（原 573 + 本任务 2）

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/rework.py apps/server/tests/test_orchestrator_rework.py
git commit -m "feat(orchestrator): 返工编排核心(同对话续聊/打回/上限/计数)"
```

---

## Task 3: `redispatch_task` 工具 + 注册

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/tools/tasks.py`（仿 update_task）
- Modify: `apps/server/src/service/agent/orchestrator/tools/__init__.py:60-85`
- Modify: `apps/server/src/service/agent/orchestrator/agent.py:352`（_serialize_db_tool 群）

- [ ] **Step 1: 写工具（tasks.py 末尾）**

```python
@tool
def redispatch_task(task_id: int, rework_note: str) -> str:
    """判定某子任务交付【不达标】时，打回让该员工在原对话续聊返工。

    用于总管一线质检：对照该任务派活契约的「输出」，若交付缺项/跑偏/质量不够，
    调本工具打回——员工会带着上一稿在同一对话里按你的说明修改。

    task_id：来自 create_orchestration_plan 返回的 tasks[].task_id。
    rework_note：把「哪里不达标 + 要改成什么样」讲清楚（员工据此修订）。
    每个任务最多自动返工 2 次，超限本工具会拒绝并提示你升级给领导定夺。
    """
    from src.service.agent.orchestrator.rework import redispatch_task_in_session
    workspace_id = get_workspace_id()
    msg = redispatch_task_in_session(workspace_id, task_id, rework_note or "")
    invalidate_orchestrator_db_cache()
    return msg
```

- [ ] **Step 2: 注册到 __init__.py**

`tools/__init__.py`：在 import 群加 `redispatch_task,`（与 update_task 同段），`__all__` 加 `"redispatch_task",`；docstring 第 10 行的工具清单补上 `redispatch_task`。

- [ ] **Step 3: 序列化进总管工具表**

`agent.py`：import 群加 `redispatch_task`，在 `_serialize_db_tool(update_task),` 旁加 `_serialize_db_tool(redispatch_task),`。

- [ ] **Step 4: 验证工具可导入、入表**

```python
# tests/test_orchestrator_rework.py 追加
def test_redispatch_tool_registered():
    from src.service.agent.orchestrator.tools import redispatch_task
    assert redispatch_task.name == "redispatch_task"
```

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py::test_redispatch_tool_registered -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/tools/tasks.py apps/server/src/service/agent/orchestrator/tools/__init__.py apps/server/src/service/agent/orchestrator/agent.py apps/server/tests/test_orchestrator_rework.py
git commit -m "feat(orchestrator): redispatch_task 工具 + 注册"
```

---

## Task 4: 评审上下文注入原契约 + superseded 标签

**说明：** 总管要判定达标，必须在上下文里看到原任务的「输出」契约。现有 `build_delegation_execution_context`（prompts.py:191）每条 log 只贴交付摘要，缺原契约 → 补上 `EmployeeTask.user_prompt`。同时给 `_STATUS_LABELS` 加 `superseded` 标签。

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py:182-242`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_orchestrator_rework.py 追加
def test_delegation_context_includes_output_contract(db_session):
    from src.service.agent.orchestrator.prompts import build_delegation_execution_context
    ws, emp, task, conv, log = _seed_task_with_settled_log(db_session)
    text = build_delegation_execution_context(db_session, ws.id, 999)
    assert "输出:TOP20" in text  # 原契约已注入，供总管对照质检
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py::test_delegation_context_includes_output_contract -v`
Expected: FAIL（上下文未含契约）

- [ ] **Step 3: 实现**

`prompts.py` 的 `_STATUS_LABELS` 加：
```python
    "superseded": "已打回",
```
`build_delegation_execution_context` 循环里，每条 log 在贴交付摘要前，注入原任务契约：
```python
        task = db.get(EmployeeTask, log.task_id) if log.task_id else None
        if task is not None and task.user_prompt:
            lines.append("- 派活契约（达标基线，对照判定）：")
            lines.append(task.user_prompt.strip())
```
并在段首引导文案补一句：
```python
        "你是一线质检：对照每条任务的「派活契约」逐项判定达标/不达标。"
        "不达标调 redispatch_task(task_id, rework_note) 打回重做，达标才上报。",
```

- [ ] **Step 4: 跑测试确认通过 + 不变量门**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py::test_delegation_context_includes_output_contract tests/test_prompt_invariants.py -q`
Expected: PASS（新用例）+ 不变量门全绿

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_orchestrator_rework.py
git commit -m "feat(orchestrator): 评审上下文注入派活契约 + superseded 标签"
```

---

## Task 5: 总管一线质检 prompt 段

**说明：** 把 §4.2 的质检+返工指令接到已有「进度汇报骨架」上，替换原软指令；**保留**反轮询护栏。

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py`（`## 委派执行之后` 段 line ~79-84 的软返工句；`## 进度汇报骨架` 段补质检标记）
- Modify: `apps/server/tests/test_prompt_invariants.py`（加锚点断言）

- [ ] **Step 1: 写不变量断言（先失败）**

```python
# tests/test_prompt_invariants.py 追加（总管段）
def test_orchestrator_qa_gate_present(orchestrator_prompt: str) -> None:
    """一线质检：redispatch_task 工具 + 质检/不达标关键词不可丢。"""
    assert "redispatch_task" in orchestrator_prompt
    assert "质检" in orchestrator_prompt or "验收" in orchestrator_prompt

def test_orchestrator_anti_polling_kept(orchestrator_prompt: str) -> None:
    """质检改写后，反轮询护栏仍在。"""
    assert "轮询" in orchestrator_prompt
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_prompt_invariants.py::test_orchestrator_qa_gate_present -v`
Expected: FAIL

- [ ] **Step 3: 改 prompt**

`prompts.py` 的 `## 委派执行之后` 段：把
> 结果不达标可直接**返工**（用 `create_orchestration_plan` 重新派活给该员工）；

替换为：
> **你是一线质检**：员工交付后，对照该任务「派活契约·输出」判定。达标→正常汇报进入领导最终验收；
> **不达标→调 `redispatch_task(task_id, rework_note)`** 打回，员工在原对话带上一稿按你说明修改（每任务最多 2 次，超限工具会拒并要你升级给领导定夺）。**不要**再用 `create_orchestration_plan` 重建计划来返工。

在 `## 进度汇报骨架` 的标记说明里补一条状态符：
> `↻ 打回返工(第N次)`——判定不达标已调 redispatch_task 时用。

确认 `## 委派执行之后` 末尾"严禁反复轮询 `list_tasks`"那句仍在（不被本次改写波及）。

- [ ] **Step 4: 跑确认通过（全不变量门）**

Run: `cd apps/server && uv run pytest tests/test_prompt_invariants.py -q`
Expected: 全绿（含 2 新断言）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_prompt_invariants.py
git commit -m "feat(orchestrator): 一线质检 prompt 段(对照契约判定/redispatch返工/留反轮询护栏)"
```

---

## Task 6: 后端暴露 `rework_count` 到执行日志 DTO

**说明：** `rework_count` 在 EmployeeTask 上，前端要显示「返工 N 次」需经 log DTO 拿到。仿 `list_execution_logs` 给每条 log 附 `employee_name` 的方式，附 `rework_count`（取其 task）。

**Files:**
- Modify: `apps/server/src/service/task_service.py`（`list_execution_logs` 给 log 附 `rework_count`；确认其已 join/批量取 task）
- Modify: `apps/server/src/schemas/task.py`（TaskExecutionLogRead 加 `rework_count: int = 0`）
- Modify: `apps/server/src/api/task_api.py:53-80`（`_task_execution_log_to_read` 加 `rework_count=getattr(item, "rework_count", 0)`）

- [ ] **Step 1: 写测试（DTO 暴露）**

```python
# tests/test_orchestrator_rework.py 追加
def test_execution_dto_exposes_rework_count():
    from src.schemas.task import TaskExecutionLogRead
    fields = TaskExecutionLogRead.model_fields
    assert "rework_count" in fields
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py::test_execution_dto_exposes_rework_count -v`
Expected: FAIL

- [ ] **Step 3: 实现**

`schemas/task.py` TaskExecutionLogRead 加 `rework_count: int = 0`（放 duration_ms 附近）。
`api/task_api.py` mapper 加 `rework_count=getattr(item, "rework_count", 0),`。
`task_service.py` `list_execution_logs`：在给 logs 附 `employee_name` 的同一处，批量取 `{task_id: rework_count}` 并 `log.rework_count = map.get(log.task_id, 0)`（沿用该函数已有的 task 批量查询；若无则加一次 `select(EmployeeTask.id, EmployeeTask.rework_count)`）。

- [ ] **Step 4: 跑确认通过 + 全量**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_rework.py -q && uv run pytest -q`
Expected: 新用例 PASS；全量 5 failed / 其余通过、零新增

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/task_service.py apps/server/src/schemas/task.py apps/server/src/api/task_api.py apps/server/tests/test_orchestrator_rework.py
git commit -m "feat(orchestrator): 执行日志 DTO 暴露 rework_count"
```

---

## Task 7: 前端「打回 / 返工 N 次」可见性

**Files:**
- Modify: `apps/web/src/types/schedule-monitor.ts`（TaskRunStatus 加 `"superseded"`；TaskExecution 加 `rework_count?`）
- Modify: `apps/web/src/components/chat/message-blocks/execution-report-card.tsx`（STATUS_CONFIG 加 superseded；header 显示「返工 N 次」）

- [ ] **Step 1: 类型**

`schedule-monitor.ts`：`TaskRunStatus` 联合加 `| "superseded"`；`TaskExecution` 加 `rework_count?: number`。`superseded` **不**加入 `ACTIVE_TASK_RUN_STATUSES`（它是已结束的打回态）。

- [ ] **Step 2: 卡片渲染**

`execution-report-card.tsx`：`STATUS_CONFIG` 加
```ts
  superseded: {
    label: "已打回",
    className: "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400",
    stampText: "已打回",
  },
```
`isFinished` 判定加入 `|| execution.run_status === "superseded"`。
在两个变体的 task_name 行后，加返工次数提示：
```tsx
        {(execution.rework_count ?? 0) > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            · 返工 {execution.rework_count} 次
          </span>
        )}
```

- [ ] **Step 3: typecheck + vitest**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"`
Expected: 90（基线，零新增）
Run: `cd apps/web && npx vitest run 2>&1 | grep "Tests "`
Expected: 1 failed（基线）

- [ ] **Step 4: format + Commit**

```bash
cd /d/code/company/digital-employe-client-web-main && npx prettier --write apps/web/src/types/schedule-monitor.ts apps/web/src/components/chat/message-blocks/execution-report-card.tsx
git add apps/web/src/types/schedule-monitor.ts apps/web/src/components/chat/message-blocks/execution-report-card.tsx
git commit -m "feat(chat): 执行卡片显示「已打回 / 返工 N 次」"
```

---

## Task 8: 端到端自检 + 收尾

- [ ] **Step 1: 后端全量基线**

Run: `cd apps/server && uv run pytest -q`
Expected: 5 failed / 其余全过（新增 test_orchestrator_rework 用例全绿、不变量门全绿），零新增失败

- [ ] **Step 2: 前端三门**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"` → 90
Run: `cd apps/web && npx vitest run 2>&1 | grep "Tests "` → 1 failed（基线）

- [ ] **Step 3: 人工冒烟（手测，非自动）**

派一个 2 步任务（如"热搜→生成 Word"），在员工交付后观察：总管是否对照契约给判定；故意让某步缺项时总管是否调 `redispatch_task` 打回、员工是否在**同一对话**带上一稿续聊修改、卡片是否显示「返工 1 次」；连续不达标 2 次后是否升级提示领导。

- [ ] **Step 4: 验收对照 spec**

对照 [spec](../specs/2026-06-16-orchestrator-qa-rework-design.md) §2 目标逐条确认；记录"总管放水"观察（为 §8 独立 reviewer 是否要做攒数据）。

---

## 风险与注意

- **`superseded` 与执行指标**：打回旧 log 从 `success` 改为 `superseded` 后，`get_execution_metrics` 的 success 计数会少 1（语义正确——未被接受）。实现 Task 4/6 时顺手确认 metrics 查询不因新状态报错（它按 success/failed/timeout/cancelled 聚合，superseded 自然落在"非成功"，无需改，但要跑一遍 metrics 相关测试确认）。
- **`db_session` fixture**：测试用现有 conftest fixture；若项目实际 fixture 名/工厂不同，按现状调整 seed helper。
- **续聊起流的真异步**：`_schedule_employee_rework_stream` 在单测里被 monkeypatch 掉，真实路径靠人工冒烟（Task 8 Step 3）覆盖——与现有 reentry/execution 的测试边界一致（真实流不进确定性单测层）。
- **DAG 下游**：初版返工只重跑本任务；下游消费返工新产物由总管在再审轮决定是否一并 redispatch（spec §7）。本计划不自动级联重算下游。

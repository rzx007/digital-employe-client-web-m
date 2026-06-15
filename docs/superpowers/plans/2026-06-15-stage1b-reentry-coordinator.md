# 阶段 1B：总管再入整合协调器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：[总览计划](2026-06-15-orchestrator-centric-overview.md) 阶段 1 第②子块（脊柱核心新难点）。基底 `feat/orchestrator-centric`（含阶段1A 共享桌）。

**Goal:** 总管"组队"派出的后台子任务全部跑完后，**自动唤醒总管起一轮整合 turn**——读全部子任务结论 + 共享桌产物，整合后交付给用户。无需用户再戳一下。

**Architecture:** **泛化现有群 summarize 回流**（`group_room_service.summarize_by_leader` + `_trigger_leader_summary_if_room`）。在 `dependency_scheduler.on_employee_task_completed` 的"整盘定局(all_settled)"分支，对**非群**计划（room 为 None）触发新的"总管再入整合"：收集该 plan 的全部 `TaskExecutionLog` → 生成整合 brief → 在总管会话上 append 占位消息 + `registry.request_start` 起一轮（调 `get_orchestrator_agent`，阶段1A 已让它自动指向共享桌）。幂等(plan.status 标记)、攒齐回流(all_settled 才触发一次)。不碰流式层、不碰群路径。

**Tech Stack:** Python / SQLAlchemy / pytest（内存 SQLite，模型 create_all，无 Alembic）。后端测试 `cd apps/server && uv run pytest tests/... -v`。

---

## 设计要点（实现前必读）

**现成链路（勘探坐实，复用）**：
```
子任务终态 → stream_registry._finalize_task_stream → server._on_task_finalized
  → dependency_scheduler.on_employee_task_completed(task_id, workspace_id)   [ds.py:264]
     → 重新评估整盘 → all_settled 且 not dispatched
        → _trigger_leader_summary_if_room(db, plan, workspace_id)            [ds.py:411] (群: room 存在才动)
```
群 summarize 的"系统起一轮"模式（`group_room_service.summarize_by_leader` [group_room_service.py:1030]）：
1. 收集产物/结论 → 生成 brief；
2. `ChatService._append_message`(user="（系统）…") + append 占位 assistant 消息；
3. `get_orchestrator_agent(conversation_id=会话, bind_context=False, enable_hitl=False)`；
4. 跨线程启动流：`get_main_loop().call_soon_threadsafe(lambda: registry.request_start(...))`。

**本子块新建**：把上面 2-4 泛化成"总管再入整合"，挂在 all_settled 分支的**非群**侧（room 为 None）。

**关键决策**：
- **触发条件**：`all_settled`（攒齐回流，spec §4.2 默认"攒里程碑"）。逐个回流是后续旋钮，本版不做。
- **幂等**：复用 `plan.status == "summarized"` 守卫（与群一致；fire 后置 summarized）。
- **群路径零变更**：再入函数内首先判 `room is None`，群计划直接 return（仍走群 summarize）。
- **归属**：新代码放 `orchestrator/reentry.py`（survives 阶段4；**不**依赖将退场的 group_room_service——跨线程启动器在 reentry.py 内自包含复制，约 25 行）。
- **agent 用桌**：`get_orchestrator_agent(conversation_id=plan.conversation_id)` 不传 shared_artifacts_dir → 阶段1A 自动指向 `orchestrator-desk/conv-<id>`，整合 turn 天然读全队产物。
- **enable_hitl=False**（与群 summarize 一致，v1）；总管要追问就写普通消息，用户下一轮答。Q2（自主答 vs 转用户）更深策略后续。
- **独立 DB session**：`get_session_local()()` 给再入流（`orchestrator_owned_db`），避免并发 session 错误（与 summarize_by_leader 同因）。

**实现注意（评审采纳）**：
- 测试构造 `TaskExecutionLog` 若 SQLite 对 `input_json`(nullable=False) 报错，补 `input_json="{}"`（多数情况 Python default 会补，先不加，报错再加）。
- `ConversationMessage` 的真实模块路径以实际为准（可能是 `src.models.conversation` 或 `src.models.conversation_message`）——实现 REJECTED 回滚时确认 import 路径。
- 跨线程启动器/REJECTED 回滚已对齐真实 `_schedule_stream_start`（含回滚占位消息防僵尸）。

**文件结构**：
- 新建：`apps/server/src/service/agent/orchestrator/reentry.py`（收集结论 / 生成 brief / 再入协调器 + 跨线程启动器）
- 改：`apps/server/src/service/agent/orchestrator/dependency_scheduler.py`（all_settled 分支加再入调用）
- 测：新建 `apps/server/tests/test_orchestrator_reentry.py`

---

## Task 1：collect_plan_execution_results（收集该 plan 全部子任务结论）

**Files:**
- Create: `apps/server/src/service/agent/orchestrator/reentry.py`
- Test: `apps/server/tests/test_orchestrator_reentry.py`

- [ ] **Step 1: 写失败测试**（新建 test 文件）

```python
import json
from src.models.orchestration_plan import OrchestrationPlan
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.utils.time import cst_now
from tests.conftest import add_employee


def _plan_with_two_tasks(db, ws_id, emp_id, conv_id):
    plan = OrchestrationPlan(
        workspace_id=ws_id, conversation_id=conv_id, user_input="做个东西",
        plan_json=json.dumps([{"depends_on": None}, {"depends_on": None}]),
        status="confirmed",
    )
    db.add(plan); db.flush()
    tasks = []
    for name in ("调研A", "调研B"):
        t = EmployeeTask(
            workspace_id=ws_id, employee_id=emp_id, task_name=name,
            orchestration_plan_id=plan.id, task_input_json="{}",
            user_prompt=f"do {name}", execute_mode="immediate",
        )
        db.add(t); db.flush(); tasks.append(t)
    db.commit()
    return plan, tasks


def test_collect_plan_execution_results(db_session, workspace):
    from src.service.agent.orchestrator.reentry import collect_plan_execution_results
    emp = add_employee(db_session, workspace.id, name="w")
    plan, (a, b) = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=100)
    db_session.add(TaskExecutionLog(
        task_id=a.id, workspace_id=workspace.id, employee_id=emp.id,
        task_name_snapshot="调研A", run_status="success",
        run_result="完成A", output_json=json.dumps({"content": "A 的结论"}),
        orchestrator_conversation_id=100, started_at=cst_now(), ended_at=cst_now(),
    ))
    db_session.add(TaskExecutionLog(
        task_id=b.id, workspace_id=workspace.id, employee_id=emp.id,
        task_name_snapshot="调研B", run_status="failed",
        run_result="失败B", error_message="boom",
        orchestrator_conversation_id=100, started_at=cst_now(), ended_at=cst_now(),
    ))
    db_session.commit()

    results = collect_plan_execution_results(db_session, plan)
    assert len(results) == 2
    by_name = {r["task_name"]: r for r in results}
    assert by_name["调研A"]["status"] == "success"
    assert by_name["调研A"]["content"] == "A 的结论"
    assert by_name["调研B"]["status"] == "failed"
    assert by_name["调研B"]["error"] == "boom"
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py::test_collect_plan_execution_results -v`
Expected: FAIL（ModuleNotFoundError / ImportError reentry）

- [ ] **Step 3: 最小实现**（新建 `reentry.py`）

```python
"""总管再入整合协调器：组队子任务全部完成后，唤醒总管起一轮整合 turn。"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog

logger = logging.getLogger(__name__)


def collect_plan_execution_results(db: Session, plan) -> list[dict[str, Any]]:
    """收集某编排计划下所有子任务的执行结论（每任务取最新一条终态日志）。"""
    tasks = db.scalars(
        select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id)
    ).all()
    results: list[dict[str, Any]] = []
    for t in tasks:
        log = db.scalars(
            select(TaskExecutionLog)
            .where(TaskExecutionLog.task_id == t.id)
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if log is None:
            results.append({"task_name": t.task_name, "status": "unknown",
                            "content": "", "error": None})
            continue
        content = ""
        if log.output_json:
            try:
                content = json.loads(log.output_json).get("content", "") or ""
            except (ValueError, TypeError):
                content = ""
        results.append({
            "task_name": t.task_name,
            "status": log.run_status,
            "content": content,
            "result": log.run_result or "",
            "error": log.error_message,
        })
    return results
```

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py -v`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/agent/orchestrator/reentry.py apps/server/tests/test_orchestrator_reentry.py
git commit -m "feat(reentry): collect_plan_execution_results 收集组队子任务结论"
```

---

## Task 2：build_reentry_brief（生成整合 brief）

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/reentry.py`
- Test: `apps/server/tests/test_orchestrator_reentry.py`

- [ ] **Step 1: 写失败测试**（追加）

```python
def test_build_reentry_brief():
    from src.service.agent.orchestrator.reentry import build_reentry_brief
    results = [
        {"task_name": "调研A", "status": "success", "content": "A结论", "result": "完成A", "error": None},
        {"task_name": "调研B", "status": "failed", "content": "", "result": "失败B", "error": "boom"},
    ]
    brief = build_reentry_brief(results)
    assert "调研A" in brief and "A结论" in brief
    assert "调研B" in brief and ("失败" in brief or "boom" in brief)
    # 必含整合指令 + 指向共享桌
    assert "整合" in brief
    assert "$WORKSPACE_DIR" in brief or "工作桌" in brief or "产物" in brief
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py::test_build_reentry_brief -v`
Expected: FAIL（ImportError build_reentry_brief）

- [ ] **Step 3: 最小实现**（追加到 reentry.py）

```python
def build_reentry_brief(results: list[dict[str, Any]]) -> str:
    """把各子任务结论拼成给总管的整合指令（系统消息）。"""
    lines: list[str] = []
    for r in results:
        head = f"### 子任务：{r['task_name']}（{r['status']}）"
        lines.append(head)
        if r.get("content"):
            lines.append(r["content"])
        elif r.get("error"):
            lines.append(f"（失败）{r['error']}")
        elif r.get("result"):
            lines.append(r["result"])
        lines.append("")
    body = "\n".join(lines).strip()
    return (
        "（系统）你派出的团队子任务已全部完成。以下是各子任务的结论，"
        "团队的产物文件都在共享工作桌（$WORKSPACE_DIR，可直接 ls/read 查看）。\n\n"
        f"{body}\n\n"
        "请你**整合**这些成果，必要时读取共享桌上的产物文件核对，"
        "然后向用户给出一份完整、连贯的交付与说明。"
        "若有子任务失败，请如实说明并给出后续建议。不要重新派活，除非确有必要。"
    )
```

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py -v`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/agent/orchestrator/reentry.py apps/server/tests/test_orchestrator_reentry.py
git commit -m "feat(reentry): build_reentry_brief 生成总管整合指令"
```

---

## Task 3：trigger_orchestrator_reentry（再入协调器 + 跨线程启动）

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/reentry.py`
- Test: `apps/server/tests/test_orchestrator_reentry.py`

- [ ] **Step 1: 写失败测试**（追加；用 monkeypatch 拦住真实起流，只验证"该起一轮、幂等、群跳过"）

```python
def test_trigger_reentry_schedules_turn_and_is_idempotent(db_session, workspace, monkeypatch):
    from src.service.agent.orchestrator import reentry
    from src.models.conversation import Conversation

    # 总管会话
    conv = Conversation(workspace_id=workspace.id, target_type="curator", target_id=0, title="总管")
    db_session.add(conv); db_session.flush()
    emp = add_employee(db_session, workspace.id, name="w")
    plan, (a, b) = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=conv.id)
    for t, st in ((a, "success"), (b, "success")):
        db_session.add(TaskExecutionLog(
            task_id=t.id, workspace_id=workspace.id, employee_id=emp.id,
            task_name_snapshot=t.task_name, run_status=st,
            output_json=json.dumps({"content": f"{t.task_name} done"}),
            orchestrator_conversation_id=conv.id, started_at=cst_now(), ended_at=cst_now(),
        ))
    db_session.commit()

    started: list[dict] = []
    monkeypatch.setattr(reentry, "_schedule_reentry_stream",
                        lambda **kw: started.append(kw))
    # 让再入用当前测试 session（避免起独立 session 连到别的库）
    monkeypatch.setattr(reentry, "_new_session", lambda: db_session)
    # get_orchestrator_agent 不真正构图
    monkeypatch.setattr(reentry, "_build_orchestrator_agent", lambda **kw: object())

    reentry.trigger_orchestrator_reentry(db_session, plan, workspace.id)
    assert len(started) == 1
    assert started[0]["conversation_id"] == conv.id
    # 幂等：plan 已标记，再调不重复起
    reentry.trigger_orchestrator_reentry(db_session, plan, workspace.id)
    assert len(started) == 1


def test_trigger_reentry_skips_group_plan(db_session, workspace, monkeypatch):
    from src.service.agent.orchestrator import reentry
    from src.models.conversation import Conversation
    from src.models.group_room import GroupRoom

    leader = Conversation(workspace_id=workspace.id, target_type="group_leader", target_id=1, title="组长")
    db_session.add(leader); db_session.flush()
    room = GroupRoom(workspace_id=workspace.id, room_conversation_id=1,
                     leader_conversation_id=leader.id)
    db_session.add(room); db_session.flush()
    emp = add_employee(db_session, workspace.id, name="w")
    plan, _ = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=leader.id)
    db_session.commit()

    started: list[dict] = []
    monkeypatch.setattr(reentry, "_schedule_reentry_stream", lambda **kw: started.append(kw))
    reentry.trigger_orchestrator_reentry(db_session, plan, workspace.id)
    assert started == []   # 群计划：再入跳过（仍走群 summarize）
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py -k trigger -v`
Expected: FAIL（trigger_orchestrator_reentry / 内部 seam 未定义）

- [ ] **Step 3: 最小实现**（追加到 reentry.py；含可被 monkeypatch 的 seam 函数）

```python
def _new_session() -> Session:
    from src.db.session import get_session_local
    return get_session_local()()


def _build_orchestrator_agent(*, workspace_id: int, db: Session, conversation_id: int):
    from src.service.agent.orchestrator import get_orchestrator_agent
    return get_orchestrator_agent(
        workspace_id=workspace_id, db=db, conversation_id=conversation_id,
        bind_context=False, enable_hitl=False,
    )


def _schedule_reentry_stream(*, conversation_id: int, agent: Any, messages: list,
                             stream_msg_id: int, workspace_id: int,
                             owned_db: Session) -> None:
    """跨线程把 registry.request_start 投到主事件循环（回调线程无 running loop）。"""
    from src.service.stream_registry import registry
    from src.service.agent_stream_queue import StartResult

    def _do_start() -> None:
        result = registry.request_start(
            conversation_id=conversation_id, agent=agent, messages=messages,
            config={"configurable": {"thread_id": conversation_id}},
            stream_msg_id=stream_msg_id, skill_name="", debug_content_only=False,
            orchestrator_workspace_id=workspace_id,
            orchestrator_conversation_id=conversation_id,
            orchestrator_owned_db=owned_db, source="orchestrator_reentry",
        )
        if result == StartResult.REJECTED:
            # 被拒（会话已有活跃流）→ 回滚占位 assistant 消息，避免永久僵尸 streaming
            logger.warning("reentry stream REJECTED conv=%s → 回滚占位消息", conversation_id)
            try:
                from src.models.conversation_message import ConversationMessage
                rb = _new_session()
                try:
                    msg = rb.get(ConversationMessage, stream_msg_id)
                    if msg is not None and msg.stream_state == "streaming":
                        msg.stream_state = "failed"
                        rb.commit()
                finally:
                    rb.close()
            except Exception:
                logger.warning("reentry REJECTED rollback failed conv=%s",
                               conversation_id, exc_info=True)

    try:
        from src.service.agent.orchestrator.runtime import get_main_loop
        get_main_loop().call_soon_threadsafe(_do_start)
    except Exception:
        _do_start()


def trigger_orchestrator_reentry(db: Session, plan, workspace_id: int) -> int | None:
    """非群编排计划全部完成 → 唤醒总管起一轮整合 turn。群计划跳过。幂等。"""
    from src.models.conversation import Conversation
    from src.models.group_room import GroupRoom
    from src.service.chat_service import ChatService

    # 群计划跳过（仍走群 summarize）
    room = db.scalars(
        select(GroupRoom).where(GroupRoom.leader_conversation_id == plan.conversation_id)
    ).first()
    if room is not None:
        return None
    # 幂等
    if plan.status == "summarized":
        return None
    conv = db.get(Conversation, plan.conversation_id)
    if conv is None:
        return None

    results = collect_plan_execution_results(db, plan)
    brief = build_reentry_brief(results)

    plan.status = "summarized"
    ChatService._append_message(db, conversation=conv, role="user",
                                content="（系统）请整合团队成果")
    assistant_msg = ChatService._append_message(db, conversation=conv,
                                                role="assistant", content="")
    assistant_msg.stream_state = "streaming"
    db.commit()

    owned_db = _new_session()
    agent = _build_orchestrator_agent(workspace_id=workspace_id, db=owned_db,
                                      conversation_id=conv.id)
    _schedule_reentry_stream(
        conversation_id=conv.id, agent=agent,
        messages=[{"role": "user", "content": brief}],
        stream_msg_id=assistant_msg.id, workspace_id=workspace_id, owned_db=owned_db,
    )
    return conv.id
```

> 实现注意：先读现有 `summarize_by_leader` 确认 `ChatService._append_message` 签名、`registry.request_start` 参数名与上面一致（以实际为准微调）。`messages` 是否要带历史：群 summarize 带了 history；本版先只发 brief（总管 agent 会从 thread_id checkpoint 拿到上下文），若实测需要历史再加（记为开放项，不在本任务）。

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py -v`
Expected: 全 PASS

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/agent/orchestrator/reentry.py apps/server/tests/test_orchestrator_reentry.py
git commit -m "feat(reentry): trigger_orchestrator_reentry 协调器（幂等+群跳过+起整合轮）"
```

---

## Task 4：挂进 dependency_scheduler 的 all_settled 分支

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/dependency_scheduler.py`（~L397-408 all_settled 分支）
- Test: `apps/server/tests/test_orchestrator_reentry.py`

- [ ] **Step 1: 写失败测试**（追加；端到端：造全 success 的非群 plan + 触发回调 → 断言再入被触发）

```python
def test_all_settled_triggers_reentry(db_session, workspace, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    from src.service.agent.orchestrator import reentry
    from src.models.conversation import Conversation

    conv = Conversation(workspace_id=workspace.id, target_type="curator", target_id=0, title="总管")
    db_session.add(conv); db_session.flush()
    emp = add_employee(db_session, workspace.id, name="w")
    plan, (a, b) = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=conv.id)
    for t in (a, b):
        db_session.add(TaskExecutionLog(
            task_id=t.id, workspace_id=workspace.id, employee_id=emp.id,
            task_name_snapshot=t.task_name, run_status="success",
            output_json=json.dumps({"content": "done"}),
            orchestrator_conversation_id=conv.id, started_at=cst_now(), ended_at=cst_now(),
        ))
    db_session.commit()

    calls: list = []
    monkeypatch.setattr(reentry, "trigger_orchestrator_reentry",
                        lambda db, pl, ws: calls.append((pl.id, ws)))
    # 让 ds 用测试库（参考 test_dependency_scheduler_failure 的 patched_task_mutations_db 模式）
    monkeypatch.setattr("src.db.session.get_session_local",
                        lambda: (lambda: db_session))

    ds.on_employee_task_completed(a.id, workspace.id)
    assert (plan.id, workspace.id) in calls
```

> 注意：`on_employee_task_completed` 内部用独立 session（`get_session_local`）。参考现有 `test_dependency_scheduler_failure.py` 的 `patched_task_mutations_db` fixture 怎么把 ds 指到测试库——**优先用那个 fixture**（比上面手写 monkeypatch 更稳）。实现期对齐现有测试夹具风格。

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py::test_all_settled_triggers_reentry -v`
Expected: FAIL（再入未挂上 → calls 空）

- [ ] **Step 3: 最小实现**

读 `dependency_scheduler.py` 的 all_settled 分支（~L397-408），在 `_trigger_leader_summary_if_room(db, plan, workspace_id)` 调用之后加一行（两者各自只在自己场景生效：群→summary、非群→reentry）：

```python
    if not dispatched:
        all_settled = all(_is_settled(t.id, status_by_task) for t in tasks)
        if all_settled:
            _trigger_leader_summary_if_room(db, plan, workspace_id)
            # 非群编排：全部完成 → 唤醒总管再入整合（群计划内部会跳过）
            from src.service.agent.orchestrator.reentry import (
                trigger_orchestrator_reentry,
            )
            trigger_orchestrator_reentry(db, plan, workspace_id)
```

> `trigger_orchestrator_reentry` 内部已判 `room is None` 才动 + `plan.status=="summarized"` 幂等，所以与 `_trigger_leader_summary_if_room`（群侧会把 status 置 summarized）**互斥安全**：群计划 → summary 置 summarized → reentry 看到 room 非 None 直接 return；非群 → summary 早返回(room None,不置status) → reentry 正常触发。

- [ ] **Step 4: 跑测试 + 回归调度器测试**
Run: `cd apps/server && uv run pytest tests/test_orchestrator_reentry.py tests/test_dependency_scheduler_failure.py -v`
Expected: 全 PASS（含群级联失败等原有调度测试不回归）

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/agent/orchestrator/dependency_scheduler.py apps/server/tests/test_orchestrator_reentry.py
git commit -m "feat(reentry): 调度器 all_settled 非群分支挂载总管再入整合"
```

---

## 收尾验证

- [ ] **全量后端测试**
Run: `cd apps/server && uv run pytest tests/ -q`
Expected: 仅预存基线失败（test_agent_runtime_policy×2 / test_orchestrator_execution_summary / test_shell_error_steering×2 等 GBK 乱码类），**零新增回归**。存疑失败用 `git worktree add /tmp/base-1b <stage1a-tip-sha>` 在基线比对。

- [ ] **手测桩**（端到端待手测）：起后端，跟总管说"组个小团队做两件独立的小事"，确认：① 两个子任务后台并行跑（子任务面板可见）；② 全部完成后**总管自动冒出一轮整合消息**（无需用户再发）；③ 整合内容引用了两个子任务结论 + 共享桌产物；④ 群聊照旧不受影响。

---

## 开放问题（实现时/手测后定夺）

- **O1 是否带历史**：再入 messages 当前只发 brief（靠 thread_id checkpoint 续上下文）。若实测总管"忘了"原始需求，改为带 history（仿 summarize_by_leader 的 `_load_history_for_agent`）。
- **O2 逐个回流旋钮**：本版攒齐回流（all_settled）。逐个/里程碑回流后续做。
- **O3 失败整合策略**：本版把失败如实写进 brief 让总管自行说明。是否自动重派/转用户问，属 Q2 更深策略，后续。
- **O4 再入 turn 是否该 enable_hitl**：本版 False（与群 summarize 一致）。若要总管在整合中能正式向用户发起 HITL，后续评估。
- **O5 嵌套再入**：若整合 turn 又派了新 plan，新 plan 完成会再触发再入（新 plan.status 独立）。预期行为；留意手测有无意外循环。
</content>

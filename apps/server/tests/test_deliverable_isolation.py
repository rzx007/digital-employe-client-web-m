"""Bug 3 — 定时轮交付物按 PlanRun 隔离（session_flags 补 run_id + collect 按 run 过滤）。"""
from __future__ import annotations

import json

from datetime import datetime

from src.models.conversation import Conversation
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace
from src.service.agent.orchestrator.plan_run_service import (
    create_scheduled_run_conversation,
    open_plan_run,
)


def _mk_plan(db_session):
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u")
    db_session.add(ws)
    db_session.flush()
    cur = Employee(
        workspace_id=ws.id, name="总管", employee_code="c", is_curator=True
    )
    db_session.add(cur)
    db_session.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id,
        conversation_id=1,
        user_input="x",
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
    )
    db_session.add(plan)
    db_session.flush()
    return ws, plan


def test_session_flags_has_run_id(db_session):
    ws, plan = _mk_plan(db_session)
    run = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    db_session.commit()
    cid = create_scheduled_run_conversation(db_session, plan, run)
    db_session.commit()
    flags = json.loads(db_session.get(Conversation, cid).session_flags or "{}")
    assert flags["run_id"] == run.id


def test_collect_deliverables_filtered_by_run(db_session, monkeypatch):
    """run_id 过滤：只返该轮子任务执行日志会话的产物。"""
    import src.service.orchestration_lifecycle as lifecycle
    from src.service.orchestration_lifecycle import collect_plan_deliverables

    ws, plan = _mk_plan(db_session)

    # 一个子任务，两轮 run、每轮一条 log（不同 conversation_id + run_id）。
    run1 = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    run2 = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    db_session.flush()

    task = EmployeeTask(
        workspace_id=ws.id,
        employee_id=1,
        task_name="t1",
        orchestration_plan_id=plan.id,
    )
    db_session.add(task)
    db_session.flush()

    log1 = TaskExecutionLog(
        task_id=task.id,
        workspace_id=ws.id,
        employee_id=1,
        conversation_id=101,
        task_name_snapshot="t1",
        run_status="success",
        run_id=run1.id,
        started_at=datetime.now(),
    )
    log2 = TaskExecutionLog(
        task_id=task.id,
        workspace_id=ws.id,
        employee_id=1,
        conversation_id=102,
        task_name_snapshot="t1",
        run_status="success",
        run_id=run2.id,
        started_at=datetime.now(),
    )
    db_session.add_all([log1, log2])
    db_session.commit()

    # 按 conversation_id 返回不同的假 write_file tool parts。
    def fake_tool_parts(db, conversation_id):
        if conversation_id == 101:
            return [
                {
                    "type": "tool-write_file",
                    "input": {"file_path": "/out/run1.txt", "content": "aaa"},
                }
            ]
        if conversation_id == 102:
            return [
                {
                    "type": "tool-write_file",
                    "input": {"file_path": "/out/run2.txt", "content": "bbb"},
                }
            ]
        return []

    from src.service.task_service import TaskService

    monkeypatch.setattr(
        TaskService, "get_conversation_tool_parts", staticmethod(fake_tool_parts)
    )
    # 绕过磁盘存在性过滤，否则断言会退化成 [] == []。
    monkeypatch.setattr(
        lifecycle, "_still_exists_nonempty", lambda path, adir: True
    )

    # run1 过滤：只应有 run1 的产物。
    res1 = collect_plan_deliverables(db_session, plan.id, run_id=run1.id)
    paths1 = {d["path"] for d in res1}
    assert paths1 == {"/out/run1.txt"}

    # run2 过滤：只应有 run2 的产物。
    res2 = collect_plan_deliverables(db_session, plan.id, run_id=run2.id)
    paths2 = {d["path"] for d in res2}
    assert paths2 == {"/out/run2.txt"}

    # 无 run_id：两轮都有（取最新一条 log 的会话 → run2）。
    res_all = collect_plan_deliverables(db_session, plan.id)
    paths_all = {d["path"] for d in res_all}
    assert paths_all == {"/out/run2.txt"}


def test_resolve_run_id_for_conversation(db_session):
    from src.service.orchestration_lifecycle import resolve_run_id_for_conversation

    ws, plan = _mk_plan(db_session)
    run = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    db_session.flush()
    run.conversation_id = 555
    db_session.commit()

    assert resolve_run_id_for_conversation(db_session, plan.id, 555) == run.id
    assert resolve_run_id_for_conversation(db_session, plan.id, 999) is None

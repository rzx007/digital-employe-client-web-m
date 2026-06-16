from src.models.employee_task import EmployeeTask


def test_employee_task_has_rework_count_default_zero():
    t = EmployeeTask(workspace_id=1, employee_id=1, task_name="x")
    assert t.rework_count == 0


import json
import pytest
from sqlalchemy import select
from src.models.employee import Employee
from src.models.conversation import Conversation
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now


def _seed_task_with_settled_log(db, *, rework_count=0, run_status="success"):
    ws = Workspace(name="w", root_path="/tmp/test-ws")
    db.add(ws)
    db.flush()
    emp = Employee(workspace_id=ws.id, name="员工A", employee_code="code-a")
    db.add(emp)
    db.flush()
    task = EmployeeTask(
        workspace_id=ws.id, employee_id=emp.id, task_name="任务X",
        user_prompt="目标:出榜单 输出:TOP20 表格", rework_count=rework_count,
    )
    db.add(task)
    db.flush()
    conv = Conversation(workspace_id=ws.id, target_type="employee", target_id=emp.id, title="任务X")
    db.add(conv)
    db.flush()
    log = TaskExecutionLog(
        task_id=task.id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="任务X", run_status=run_status, run_result="done",
        input_json="{}", output_json=json.dumps({"content": "只有 TOP10"}),
        conversation_id=conv.id, orchestrator_conversation_id=999,
        started_at=cst_now(), ended_at=cst_now(), reported_at=cst_now(),
    )
    db.add(log)
    db.commit()
    return ws, emp, task, conv, log


def test_redispatch_rejects_when_cap_reached(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    # 让 rework 模块的 _new_session() 返回同一测试 session（共享同一 SQLite 事务）
    monkeypatch.setattr(rework, "_new_session", lambda: db_session)
    ws, emp, task, conv, log = _seed_task_with_settled_log(
        db_session, rework_count=rework.MAX_REWORK
    )
    old_id = log.id
    msg = rework.redispatch_task_in_session(ws.id, task.id, "TOP10 不够，要 TOP20")
    assert "上限" in msg or "定夺" in msg
    logs = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id)
    ).all()
    assert len(logs) == 1
    assert db_session.get(EmployeeTask, task.id).rework_count == rework.MAX_REWORK
    assert db_session.get(TaskExecutionLog, old_id).run_status != "superseded"


def test_redispatch_supersedes_old_and_creates_new_same_conversation(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    captured = {}
    monkeypatch.setattr(
        rework, "_schedule_employee_rework_stream",
        lambda **k: captured.update(k),
    )
    # 让 rework 模块的 _new_session() 返回同一测试 session（共享同一 SQLite 事务）
    monkeypatch.setattr(rework, "_new_session", lambda: db_session)
    ws, emp, task, conv, old = _seed_task_with_settled_log(db_session)
    old_id = old.id
    msg = rework.redispatch_task_in_session(ws.id, task.id, "TOP10 不够，要 TOP20")
    # db.close() in rework expunges objects; re-fetch by id
    db_session.expire_all()
    refreshed_old = db_session.get(TaskExecutionLog, old_id)
    assert refreshed_old.run_status == "superseded"
    logs = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id).order_by(TaskExecutionLog.id.asc())
    ).all()
    assert len(logs) == 2
    new = logs[-1]
    assert new.conversation_id == conv.id
    assert new.orchestrator_conversation_id == 999
    assert new.reported_at is None
    assert db_session.get(EmployeeTask, task.id).rework_count == 1
    assert captured.get("conversation_id") == conv.id
    assert captured.get("agent") is not None


def test_redispatch_rejects_when_latest_log_inflight(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(rework, "_new_session", lambda: db_session)
    ws, emp, task, conv, log = _seed_task_with_settled_log(
        db_session, run_status="running"
    )
    old_id = log.id
    msg = rework.redispatch_task_in_session(ws.id, task.id, "改一下")
    assert "进行中" in msg
    # 未建新 log
    logs = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id)
    ).all()
    assert len(logs) == 1
    # 旧 log 状态未被改动
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, old_id).run_status == "running"
    # rework_count 未变
    assert db_session.get(EmployeeTask, task.id).rework_count == 0


def test_redispatch_tool_registered():
    from src.service.agent.orchestrator.tools import redispatch_task
    assert redispatch_task.name == "redispatch_task"


def test_delegation_context_includes_output_contract(db_session):
    from src.service.agent.orchestrator.prompts import build_delegation_execution_context
    ws, emp, task, conv, log = _seed_task_with_settled_log(db_session)
    text = build_delegation_execution_context(db_session, ws.id, 999)
    assert "输出:TOP20" in text  # 原契约已注入，供总管对照质检


def test_execution_dto_exposes_rework_count():
    from src.schemas.task import TaskExecutionLogRead
    fields = TaskExecutionLogRead.model_fields
    assert "rework_count" in fields


def test_redispatch_rejects_when_log_has_no_orchestrator_conversation(db_session, monkeypatch):
    """守卫：旧 log 无 orchestrator_conversation_id 时拒绝（否则新 log 选不中、静默失败）。"""
    from src.service.agent.orchestrator import rework
    monkeypatch.setattr(rework, "_new_session", lambda: db_session)
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    ws, emp, task, conv, log = _seed_task_with_settled_log(db_session)
    log.orchestrator_conversation_id = None
    db_session.commit()
    old_id = log.id
    msg = rework.redispatch_task_in_session(ws.id, task.id, "改一下")
    assert "未关联总管会话" in msg
    logs = db_session.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id)
    ).all()
    assert len(logs) == 1
    assert db_session.get(TaskExecutionLog, old_id).run_status != "superseded"
    assert db_session.get(EmployeeTask, task.id).rework_count == 0

"""create_orchestration_plan 返回真实 task_id。"""

from __future__ import annotations

import json

from src.models.conversation import Conversation
from src.models.employee_task import EmployeeTask
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.tools import create_orchestration_plan
from tests.conftest import add_employee


def test_create_orchestration_plan_returns_numeric_task_ids(
    db_session, workspace
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="总管",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)

    set_context(
        db=db_session,
        workspace_id=workspace.id,
        conversation_id=conv.id,
    )

    raw = create_orchestration_plan.invoke({
        "summary": "测试计划",
        "tasks": [{
            "employee_id": employee.id,
            "task_name": "子任务A",
            "prompt": "执行",
            "cron": "30 9 * * *",
        }],
    })

    payload_line = raw.split("\n", 1)[0]
    payload = json.loads(payload_line)

    assert payload["type"] == "plan_generated"
    assert payload["requires_confirmation"] is True
    assert len(payload["tasks"]) == 1
    task_id = payload["tasks"][0]["task_id"]
    assert isinstance(task_id, int)

    db_task = db_session.get(EmployeeTask, task_id)
    assert db_task is not None
    assert db_task.task_name == "子任务A"
    assert db_task.orchestration_plan_id == payload["plan_id"]
    assert "plan_id=" in raw
    assert "不可用于 delete_task" in raw


def _setup_orch(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    conv = Conversation(
        workspace_id=workspace.id, target_type="curator", target_id=1, title="总管",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=conv.id)
    return employee


def test_create_auto_executes_readonly_single_task(db_session, workspace, monkeypatch):
    """单个只读/查询类任务（small 档、无 cron、无破坏性词）→ 免确认，自动执行。"""
    employee = _setup_orch(db_session, workspace)
    import src.service.agent.orchestrator.tools.plans as plans_mod

    calls: list[int] = []
    monkeypatch.setattr(
        plans_mod, "execute_plan",
        lambda db, plan, workspace_id: calls.append(plan.id) or "编排计划执行中：",
    )

    raw = create_orchestration_plan.invoke({
        "summary": "查热搜",
        "tasks": [{
            "employee_id": employee.id,
            "task_name": "查询微博热搜",
            "prompt": "查询今日微博热搜 TOP20 并整理成榜单返回",
            "output_tier": "small",
        }],
    })

    payload = json.loads(raw.split("\n", 1)[0])
    assert payload["requires_confirmation"] is False
    assert len(calls) == 1 and calls[0] == payload["plan_id"]
    assert "自动执行" in raw


def test_create_does_not_auto_execute_when_confirmation_required(
    db_session, workspace, monkeypatch
):
    """非 small 档单任务 → 仍需确认，不自动执行。"""
    employee = _setup_orch(db_session, workspace)
    import src.service.agent.orchestrator.tools.plans as plans_mod

    calls: list[int] = []
    monkeypatch.setattr(
        plans_mod, "execute_plan",
        lambda db, plan, workspace_id: calls.append(plan.id) or "X",
    )

    raw = create_orchestration_plan.invoke({
        "summary": "写报告",
        "tasks": [{
            "employee_id": employee.id,
            "task_name": "写完整报告",
            "prompt": "撰写一份完整的市场调研报告",
            "output_tier": "large",
        }],
    })

    payload = json.loads(raw.split("\n", 1)[0])
    assert payload["requires_confirmation"] is True
    assert calls == []

"""create_orchestration_plan 返回真实 task_id。"""

from __future__ import annotations

import json

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
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


def _make_conv(db_session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="总管",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def _invoke_create(employee, summary="测试计划"):
    return create_orchestration_plan.invoke({
        "summary": summary,
        "tasks": [{
            "employee_id": employee.id,
            "task_name": "子任务A",
            "prompt": "执行",
            "cron": "30 9 * * *",
        }],
    })


def test_create_rejects_when_pending_plan_exists(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    conv = _make_conv(db_session, workspace)
    set_context(
        db=db_session,
        workspace_id=workspace.id,
        conversation_id=conv.id,
    )

    first = _invoke_create(employee)
    assert "已生成" in first

    second = _invoke_create(employee, summary="重复计划")
    assert "已有待确认计划" in second

    count = (
        db_session.query(OrchestrationPlan)
        .filter(OrchestrationPlan.conversation_id == conv.id)
        .count()
    )
    assert count == 1


def test_create_allowed_after_confirm(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    conv = _make_conv(db_session, workspace)
    set_context(
        db=db_session,
        workspace_id=workspace.id,
        conversation_id=conv.id,
    )

    first = _invoke_create(employee)
    assert "已生成" in first

    plan = (
        db_session.query(OrchestrationPlan)
        .filter(OrchestrationPlan.conversation_id == conv.id)
        .one()
    )
    plan.status = "confirmed"
    db_session.add(plan)
    db_session.commit()

    second = _invoke_create(employee, summary="第二个计划")
    assert "已生成" in second
    assert "已有待确认计划" not in second

    count = (
        db_session.query(OrchestrationPlan)
        .filter(OrchestrationPlan.conversation_id == conv.id)
        .count()
    )
    assert count == 2


def test_create_writes_message_id_from_latest_assistant_msg(
    db_session, workspace
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    conv = _make_conv(db_session, workspace)

    # 历史里先有一条 user 消息，再有一条 assistant 消息（最新）。
    db_session.add(
        ConversationMessage(
            conversation_id=conv.id, role="user", content="帮我安排"
        )
    )
    assistant_msg = ConversationMessage(
        conversation_id=conv.id, role="assistant", content="好的，我来拆解"
    )
    db_session.add(assistant_msg)
    db_session.commit()
    db_session.refresh(assistant_msg)
    assistant_id = assistant_msg.id

    set_context(
        db=db_session,
        workspace_id=workspace.id,
        conversation_id=conv.id,
    )

    _invoke_create(employee)

    plan = (
        db_session.query(OrchestrationPlan)
        .filter(OrchestrationPlan.conversation_id == conv.id)
        .one()
    )
    assert plan.message_id == assistant_id

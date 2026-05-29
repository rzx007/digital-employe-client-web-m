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

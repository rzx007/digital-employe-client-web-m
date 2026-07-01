"""orchestrator prompts：员工表上下文注入。"""

from __future__ import annotations

from src.models.employee_task import EmployeeTask
from src.models.workspace import Workspace
from src.service.agent.orchestrator.prompts import build_employee_capability_context
from tests.conftest import add_employee


def test_employee_table_includes_scheduled_tasks(db_session, workspace: Workspace):
    emp = add_employee(db_session, workspace.id, name="微博热搜助手")
    db_session.add(
        EmployeeTask(
            workspace_id=workspace.id,
            employee_id=emp.id,
            employee_name_snapshot=emp.name,
            task_name="每日热搜播报",
            dispatch_type="skill",
            cron_expression="0 9 * * *",
            cron_expression_type="custom",
            user_prompt="查热搜",
            execute_mode="scheduled",
            source="manual",
            is_active=True,
        )
    )
    db_session.commit()

    table = build_employee_capability_context(db_session, f"u-ws{workspace.id}", workspace.id)

    assert "活跃定时任务" in table
    assert "每日热搜播报" in table
    assert "微博热搜助手" in table


def test_employee_table_shows_no_scheduled_tasks(db_session, workspace: Workspace):
    add_employee(db_session, workspace.id, name="空闲助手")

    table = build_employee_capability_context(db_session, f"u-ws{workspace.id}", workspace.id)

    assert "活跃定时任务" in table
    assert "| 无 |" in table

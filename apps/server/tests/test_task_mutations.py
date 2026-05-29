"""task_mutations 单删/批量删/更新（独立 Session）。"""

from __future__ import annotations

import json
import tempfile

from src.models.employee_task import EmployeeTask
from src.models.workspace import Workspace
from src.service.agent.orchestrator.task_mutations import (
    _delete_task_with_fresh_session,
    _update_task_with_fresh_session,
    delete_tasks_batch,
)
from src.service.agent.orchestrator.tools import delete_task, update_task
from src.service.agent.orchestrator.runtime import set_context
from tests.conftest import add_employee


def add_task(
    db,
    workspace_id: int,
    employee_id: int,
    *,
    task_name: str = "测试任务",
    cron: str = "",
) -> EmployeeTask:
    task = EmployeeTask(
        workspace_id=workspace_id,
        employee_id=employee_id,
        employee_name_snapshot="员工",
        task_name=task_name,
        dispatch_type="skill",
        cron_expression=cron,
        cron_expression_type="custom",
        user_prompt="do something",
        execute_mode="scheduled" if cron else "immediate",
        source="manual",
        is_active=True,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def reload_task(db_session, task_id: int) -> EmployeeTask | None:
    """独立 Session 写入后，清缓存再读。"""
    db_session.expire_all()
    return db_session.get(EmployeeTask, task_id)


def test_delete_task_with_fresh_session_success(
    db_session, workspace, patched_task_mutations_db
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task = add_task(db_session, workspace.id, employee.id, task_name="待删任务")

    result = _delete_task_with_fresh_session(workspace.id, task.id)

    assert result.get("error") is None
    assert result["task_id"] == task.id
    assert result["task_name"] == "待删任务"
    assert reload_task(db_session, task.id) is None


def test_delete_task_with_fresh_session_not_found(
    db_session, workspace, patched_task_mutations_db
):
    result = _delete_task_with_fresh_session(workspace.id, 99999)
    assert "不存在" in result.get("error", "")


def test_delete_tasks_batch_partial_failure(
    db_session, workspace, patched_task_mutations_db, monkeypatch
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task_a = add_task(db_session, workspace.id, employee.id, task_name="任务A")
    task_b = add_task(db_session, workspace.id, employee.id, task_name="任务B")
    task_a_id = task_a.id
    task_b_id = task_b.id
    reload_calls: list[int] = []

    def _track_reload():
        reload_calls.append(1)

    monkeypatch.setattr(
        "src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        _track_reload,
    )

    raw = delete_tasks_batch(
        workspace.id,
        [task_a_id, 99999, task_b_id],
        reload_scheduler=True,
    )
    payload = json.loads(raw)

    assert payload["type"] == "tasks_deleted"
    assert payload["succeeded_count"] == 2
    assert payload["failed_count"] == 1
    assert len(reload_calls) == 1
    assert reload_task(db_session, task_a_id) is None
    assert reload_task(db_session, task_b_id) is None


def test_update_task_with_fresh_session_name_only(
    db_session, workspace, patched_task_mutations_db
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task = add_task(db_session, workspace.id, employee.id, task_name="旧名称")

    result = _update_task_with_fresh_session(
        workspace.id,
        task.id,
        task_name="新名称",
    )

    assert result.get("error") is None
    assert result["changed"] == ["任务名称"]
    refreshed = reload_task(db_session, task.id)
    assert refreshed is not None
    assert refreshed.task_name == "新名称"


def test_update_task_with_fresh_session_cron(
    db_session, workspace, patched_task_mutations_db
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task = add_task(db_session, workspace.id, employee.id, cron="")

    result = _update_task_with_fresh_session(
        workspace.id,
        task.id,
        cron="30 9 * * *",
    )

    assert result.get("error") is None
    assert "调度时间" in result["changed"]
    refreshed = reload_task(db_session, task.id)
    assert refreshed is not None
    assert refreshed.cron_expression == "30 9 * * *"
    assert refreshed.execute_mode == "scheduled"


def test_delete_tasks_batch_tool(
    db_session, workspace, patched_task_mutations_db, monkeypatch
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task_a = add_task(db_session, workspace.id, employee.id, task_name="任务A")
    task_b = add_task(db_session, workspace.id, employee.id, task_name="任务B")
    task_a_id = task_a.id
    task_b_id = task_b.id
    reload_calls: list[int] = []

    monkeypatch.setattr(
        "src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        lambda: reload_calls.append(1),
    )

    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    from src.service.agent.orchestrator.tools import delete_tasks_batch as delete_batch_tool

    raw = delete_batch_tool.invoke({"task_ids": json.dumps([task_a_id, task_b_id])})
    payload = json.loads(raw)

    assert payload["succeeded_count"] == 2
    assert len(reload_calls) == 1
    assert reload_task(db_session, task_a_id) is None
    assert reload_task(db_session, task_b_id) is None


def test_delete_task_tool_returns_error_for_missing(
    db_session, workspace, patched_task_mutations_db
):
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    result = delete_task.invoke({"task_id": 40404})
    assert result.startswith("错误：")


def test_update_task_tool_no_op(
    db_session, workspace, patched_task_mutations_db
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task = add_task(db_session, workspace.id, employee.id)

    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    result = update_task.invoke({"task_id": task.id})
    assert result == "未做任何修改。"


def test_update_rejects_employee_from_other_workspace(
    db_session, workspace, patched_task_mutations_db
):
    other_ws = Workspace(
        id=2,
        name="Other Workspace",
        root_path=tempfile.mkdtemp(prefix="de-test-ws-other-"),
    )
    db_session.add(other_ws)
    db_session.commit()

    owner = add_employee(db_session, workspace.id, name="任务员工")
    outsider = add_employee(db_session, other_ws.id, name="外来员工")
    task = add_task(db_session, workspace.id, owner.id)

    result = _update_task_with_fresh_session(
        workspace.id,
        task.id,
        employee_id=outsider.id,
    )

    assert "不属于当前工作空间" in result.get("error", "")
    refreshed = reload_task(db_session, task.id)
    assert refreshed is not None
    assert refreshed.employee_id == owner.id


def test_update_tool_refreshes_shared_session_for_list_tasks(
    db_session, workspace, patched_task_mutations_db
):
    from src.service.agent.orchestrator.tools import list_tasks

    employee = add_employee(db_session, workspace.id, name="执行员工")
    task = add_task(db_session, workspace.id, employee.id, task_name="旧名称")
    db_session.get(EmployeeTask, task.id)

    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    update_task.invoke({"task_id": task.id, "task_name": "新名称"})

    listing = list_tasks.invoke({})
    assert "新名称" in listing
    assert "旧名称" not in listing

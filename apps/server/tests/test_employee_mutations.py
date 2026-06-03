"""employee_mutations 单人/批量解聘（独立 Session）。"""

from __future__ import annotations

import json
import tempfile

from src.models.employee import Employee
from src.models.workspace import Workspace
from src.service.agent.orchestrator.employee_mutations import (
    _delete_employee_with_fresh_session,
    delete_employees_batch,
)
from src.service.agent.orchestrator.runtime import set_context
from tests.conftest import add_employee


def reload_employee(db_session, employee_id: int) -> Employee | None:
    """独立 Session 写入后，清缓存再读。"""
    db_session.expire_all()
    return db_session.get(Employee, employee_id)


def test_delete_employee_with_fresh_session_success(
    db_session, workspace, patched_task_mutations_db
):
    employee = add_employee(db_session, workspace.id, name="待解聘员工")
    employee_id = employee.id

    result = _delete_employee_with_fresh_session(workspace.id, employee_id)

    assert result.get("error") is None
    assert result["employee_id"] == employee_id
    assert result["employee_name"] == "待解聘员工"
    assert reload_employee(db_session, employee_id) is None


def test_delete_employee_with_fresh_session_not_found(
    db_session, workspace, patched_task_mutations_db
):
    result = _delete_employee_with_fresh_session(workspace.id, 99999)
    assert "不存在" in result.get("error", "")


def test_delete_employee_with_fresh_session_rejects_curator(
    db_session, workspace, patched_task_mutations_db
):
    curator = add_employee(
        db_session, workspace.id, name="总管助手", is_curator=True
    )
    curator_id = curator.id

    result = _delete_employee_with_fresh_session(workspace.id, curator_id)

    assert "总管助手" in result.get("error", "")
    assert reload_employee(db_session, curator_id) is not None


def test_delete_employee_with_fresh_session_rejects_other_workspace(
    db_session, workspace, patched_task_mutations_db
):
    other_ws = Workspace(
        id=2,
        name="Other Workspace",
        root_path=tempfile.mkdtemp(prefix="de-test-ws-other-"),
    )
    db_session.add(other_ws)
    db_session.commit()

    outsider = add_employee(db_session, other_ws.id, name="外来员工")
    outsider_id = outsider.id

    result = _delete_employee_with_fresh_session(workspace.id, outsider_id)

    assert "不属于当前工作空间" in result.get("error", "")
    assert reload_employee(db_session, outsider_id) is not None


def test_delete_employees_batch_partial_failure(
    db_session, workspace, patched_task_mutations_db, monkeypatch
):
    emp_a = add_employee(db_session, workspace.id, name="员工A")
    emp_b = add_employee(db_session, workspace.id, name="员工B")
    emp_a_id = emp_a.id
    emp_b_id = emp_b.id
    reload_calls: list[int] = []

    monkeypatch.setattr(
        "src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        lambda: reload_calls.append(1),
    )

    raw = delete_employees_batch(
        workspace.id,
        [emp_a_id, 99999, emp_b_id],
        reload_scheduler=True,
    )
    payload = json.loads(raw)

    assert payload["type"] == "employees_dismissed"
    assert payload["succeeded_count"] == 2
    assert payload["failed_count"] == 1
    assert len(reload_calls) == 1
    assert reload_employee(db_session, emp_a_id) is None
    assert reload_employee(db_session, emp_b_id) is None


def test_delete_employees_batch_all_failed_no_reload(
    db_session, workspace, patched_task_mutations_db, monkeypatch
):
    reload_calls: list[int] = []
    monkeypatch.setattr(
        "src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        lambda: reload_calls.append(1),
    )

    raw = delete_employees_batch(workspace.id, [88888, 99999])
    payload = json.loads(raw)

    assert payload["succeeded_count"] == 0
    assert payload["failed_count"] == 2
    assert len(reload_calls) == 0


def test_delete_employees_batch_empty():
    assert delete_employees_batch(1, []).startswith("错误：")


def test_delete_employees_batch_over_limit(workspace):
    raw = delete_employees_batch(workspace.id, list(range(1, 20)))
    assert raw.startswith("错误：")
    assert "最多" in raw


def test_delete_employees_batch_tool(
    db_session, workspace, patched_task_mutations_db, monkeypatch
):
    emp_a = add_employee(db_session, workspace.id, name="员工A")
    emp_b = add_employee(db_session, workspace.id, name="员工B")
    emp_a_id = emp_a.id
    emp_b_id = emp_b.id
    reload_calls: list[int] = []

    monkeypatch.setattr(
        "src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        lambda: reload_calls.append(1),
    )

    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    from src.service.agent.orchestrator.tools import (
        delete_employees_batch as dismiss_tool,
    )

    raw = dismiss_tool.invoke(
        {"employee_ids": json.dumps([emp_a_id, emp_b_id])}
    )
    payload = json.loads(raw)

    assert payload["type"] == "employees_dismissed"
    assert payload["succeeded_count"] == 2
    assert len(reload_calls) == 1
    assert reload_employee(db_session, emp_a_id) is None
    assert reload_employee(db_session, emp_b_id) is None


def test_delete_employees_batch_tool_invalid_json(
    db_session, workspace, patched_task_mutations_db
):
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    from src.service.agent.orchestrator.tools import (
        delete_employees_batch as dismiss_tool,
    )

    result = dismiss_tool.invoke({"employee_ids": "not-json"})
    assert result.startswith("错误：")

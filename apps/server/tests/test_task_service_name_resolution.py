"""验证执行日志/任务列表的员工名映射按 employee_id 直接解析，
与员工 cosmetic workspace_id 无关（多工作空间迁移后 stamp 可能 != 日志 workspace）。"""

from __future__ import annotations

import tempfile

import pytest

from src.models.employee import Employee
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now
from src.service.task_service import TaskService


def _make_workspace(db_session, ws_id: int = 1) -> Workspace:
    root = tempfile.mkdtemp(prefix="de-test-ws-")
    ws = Workspace(id=ws_id, name=f"WS-{ws_id}", root_path=root)
    db_session.add(ws)
    db_session.commit()
    return ws


def test_single_log_name_resolves_by_id_regardless_of_workspace(db_session):
    """员工 stamp=99，日志 workspace=1，名字 'Zoe' 仍能解析。
    旧实现按 Employee.workspace_id == 1 过滤会查不到该员工，得到空名。"""
    _make_workspace(db_session, ws_id=1)

    emp = Employee(workspace_id=99, user_id="u1", employee_code="e", name="Zoe")
    db_session.add(emp)
    db_session.flush()

    log = TaskExecutionLog(
        workspace_id=1,
        employee_id=emp.id,
        task_name_snapshot="t",
        run_status="queued",
        started_at=cst_now(),
    )
    db_session.add(log)
    db_session.commit()

    resolved = TaskService.mark_task_execution_log_read(
        db_session, workspace_id=1, execution_log_id=log.id
    )
    assert resolved.employee_name == "Zoe"


def test_paginated_list_name_map_resolves_by_id_regardless_of_workspace(db_session):
    """list_execution_logs 的分页名映射也应按 id 解析（stamp 99 != ws 1）。"""
    _make_workspace(db_session, ws_id=1)

    emp = Employee(workspace_id=99, user_id="u1", employee_code="e", name="Zoe")
    db_session.add(emp)
    db_session.flush()

    log = TaskExecutionLog(
        workspace_id=1,
        employee_id=emp.id,
        task_name_snapshot="t",
        run_status="success",
        started_at=cst_now(),
    )
    db_session.add(log)
    db_session.commit()

    items, total = TaskService.list_execution_logs(db_session, workspace_id=1)
    assert total == 1
    assert items[0].employee_name == "Zoe"

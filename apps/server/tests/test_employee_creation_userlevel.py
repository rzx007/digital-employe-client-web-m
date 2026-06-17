"""多工作空间 SP1 Task 5.3：员工创建/重命名/雇佣的 user_id 列写入 + 重名校验改 user 级。

覆盖三处：
- recruitment._validate_hire_name：重名按 user_id 去重（非 workspace）。
- employee_service.update_employee：重命名去重按 user_id。
- employee_service.create_employee：写入 user_id = workspace.owner。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.models.employee import Employee
from src.models.workspace import Workspace
from src.schemas.employee import EmployeeCreate, EmployeeUpdate
from src.service.agent.orchestrator.recruitment import _validate_hire_name
from src.service.employee_service import EmployeeService


def test_validate_hire_name_dedup_by_user(db_session):
    db_session.add(
        Employee(
            workspace_id=1, user_id="u1", employee_code="e1", name="Alice"
        )
    )
    db_session.commit()
    # 同一用户、同名 → 拒绝
    assert _validate_hire_name(db_session, "u1", "Alice") is not None
    # 不同用户、同名 → 允许（None）
    assert _validate_hire_name(db_session, "u2", "Alice") is None


def test_update_employee_rename_dedup_by_user(db_session):
    # 同一用户下两名员工，重命名其一为另一人名字 → 400
    a = Employee(workspace_id=1, user_id="u1", employee_code="ea", name="Aaa")
    b = Employee(workspace_id=1, user_id="u1", employee_code="eb", name="Bbb")
    # 另一用户下占用 "Bbb" → 不应阻止 u1 内的改名
    other = Employee(
        workspace_id=2, user_id="u2", employee_code="eo", name="Bbb"
    )
    db_session.add_all([a, b, other])
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        EmployeeService.update_employee(
            db_session,
            a.id,
            EmployeeUpdate(employee_name="Bbb"),
            token="",
        )
    assert exc.value.status_code == 400

    # 改成跨用户已存在但本用户未占用的名字 "Ccc" → 允许
    updated = EmployeeService.update_employee(
        db_session,
        a.id,
        EmployeeUpdate(employee_name="Ccc"),
        token="",
    )
    assert updated.name == "Ccc"


def test_create_employee_sets_user_id_to_workspace_owner(db_session):
    ws = Workspace(
        id=7, name="WS7", root_path="/tmp/ws7-de-test", user_id="u7"
    )
    db_session.add(ws)
    db_session.commit()

    employee = EmployeeService.create_employee(
        db_session,
        EmployeeCreate(
            workspace_id=ws.id,
            employee_name="Zed",
            status=1,
            skill_ids=[],
            mcp_ids=None,
            shift_schedule=None,
            tasks=None,
            user_id=None,
        ),
        token="",
    )
    # workspace owner（u7）为权威归属，覆盖 obj_in.user_id（None）
    assert employee.user_id == "u7"

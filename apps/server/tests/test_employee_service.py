"""EmployeeService.update_employee：总管保护与增量字段。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.schemas.employee import EmployeeUpdate
from src.service.employee_service import EmployeeService
from tests.conftest import add_employee


def test_update_employee_rejects_curator(db_session, workspace):
    curator = add_employee(
        db_session, workspace.id, name="总管助手", is_curator=True
    )
    payload = EmployeeUpdate.model_validate({"employee_name": "新名称"})

    with pytest.raises(HTTPException) as exc_info:
        EmployeeService.update_employee(db_session, curator.id, payload, "")

    assert exc_info.value.status_code == 400
    assert "总管" in str(exc_info.value.detail)


def test_update_employee_skill_ids_only_preserves_name(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="数据分析师")
    payload = EmployeeUpdate.model_validate({"skill_ids": []})

    assert "employee_name" not in payload.model_fields_set

    updated = EmployeeService.update_employee(
        db_session, employee.id, payload, ""
    )

    assert updated.name == "数据分析师"


def test_update_employee_name_when_explicitly_set(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="旧名称")
    payload = EmployeeUpdate.model_validate({"employee_name": "新名称"})

    updated = EmployeeService.update_employee(
        db_session, employee.id, payload, ""
    )

    assert updated.name == "新名称"

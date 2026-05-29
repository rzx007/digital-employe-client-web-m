"""orchestrator recruitment 录用与错误返回。"""

from __future__ import annotations

import json

from src.schemas.employee import EmployeeCreate
from src.service.agent.orchestrator.recruitment import (
    hire_candidate,
    hire_candidates_batch,
    recruit_candidates,
)
from src.service.employee_service import EmployeeService
from tests.conftest import add_employee


def test_hire_candidate_duplicate_name_returns_plain_error(
    db_session, workspace, patched_recruitment_db
):
    add_employee(db_session, workspace.id, name="重复员工")

    result = hire_candidate(
        workspace.id,
        "重复员工",
        "描述",
        [],
        token="",
    )

    assert result.startswith("错误：创建员工失败")
    assert "重复" in result or "已存在" in result


def test_hire_candidate_success_returns_json(
    db_session, workspace, patched_recruitment_db
):
    result = hire_candidate(
        workspace.id,
        "新入职员工",
        "职责描述",
        [],
        token="",
    )

    payload = json.loads(result)
    assert payload["type"] == "employee_hired"
    assert payload["employee_name"] == "新入职员工"


def test_hire_candidates_batch_partial_failure(
    db_session, workspace, patched_recruitment_db
):
    add_employee(db_session, workspace.id, name="已有员工")

    result = hire_candidates_batch(
        workspace.id,
        [
            {"name": "已有员工", "description": "d1", "skill_ids": []},
            {"name": "新员工乙", "description": "d2", "skill_ids": []},
        ],
        token="",
    )

    payload = json.loads(result)
    assert payload["type"] == "employees_hired"
    assert payload["succeeded_count"] == 1
    assert payload["failed_count"] == 1
    assert payload["succeeded"][0]["employee_name"] == "新员工乙"


def test_recruit_candidates_empty_request_returns_plain_error(
    db_session, workspace, monkeypatch
):
    _ = db_session, workspace

    result = recruit_candidates(workspace.id, "   ", count=1)

    assert result.startswith("错误：")


def test_create_employee_via_service_uses_pending_code(
    db_session, workspace, patched_recruitment_db
):
    employee_in = EmployeeCreate(
        workspace_id=workspace.id,
        employee_name="代码测试员工",
        capability_desc="desc",
        status=1,
        skill_ids=[],
    )
    created = EmployeeService.create_employee(db_session, employee_in, "")
    assert created.employee_code == str(created.id)

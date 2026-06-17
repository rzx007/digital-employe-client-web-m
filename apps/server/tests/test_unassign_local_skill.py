"""删除本地技能时解除员工绑定。"""

from __future__ import annotations

import json
from pathlib import Path

from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService
from src.service.local_skill_service import LocalSkillService
from tests.conftest import add_employee


def test_unassign_local_skill_from_assignees(
    db_session,
    workspace,
    monkeypatch,
    tmp_path: Path,
):
    skill_name = "station-debug-flow"
    local_id = -205
    employee_root = tmp_path / "employees"
    monkeypatch.setattr(
        EmployeeService,
        "_resolve_skill_root",
        lambda: employee_root,
    )

    employee = add_employee(db_session, workspace.id, name="电力设备查询工程师")
    db_session.add(
        EmployeeSkill(
            workspace_id=workspace.id,
            employee_id=employee.id,
            skill_id=local_id,
            skill_name=skill_name,
            skill_name_zh="tmr数据召测技能",
            skill_description="tmr数据召测技能",
        )
    )
    db_session.commit()

    copied = employee_root / str(employee.id) / "skills" / skill_name
    copied.mkdir(parents=True)
    (copied / "SKILL.md").write_text("# tmr", encoding="utf-8")

    count = EmployeeService.unassign_local_skill_from_assignees(
        db_session,
        user_id=f"u-ws{workspace.id}",
        skill_name=skill_name,
        local_id=local_id,
    )

    assert count == 1
    assert db_session.query(EmployeeSkill).count() == 0
    assert not copied.exists()
    meta = json.loads(employee.meta_json or "{}")
    assert meta.get("skills") == []

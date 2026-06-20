"""LocalSkill 保存后同步至已分配员工。"""

from __future__ import annotations

import json
from pathlib import Path

from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService
from src.service.local_skill_service import LocalSkillService
from tests.conftest import add_employee


def test_sync_local_skill_to_assignees_updates_employee_skill(
    db_session,
    workspace,
    monkeypatch,
    tmp_path: Path,
):
    skill_name = "demo-skill"
    local_id = -101
    skill_root = tmp_path / "local-skills" / str(workspace.id) / skill_name
    skill_root.mkdir(parents=True)
    (skill_root / LocalSkillService.SKILL_MD_NAME).write_text(
        "---\ndescription: 演示技能\n---\n# Demo",
        encoding="utf-8",
    )
    (skill_root / LocalSkillService.META_FILE_NAME).write_text(
        json.dumps(
            {
                "skillName": skill_name,
                "localId": local_id,
                "displayNameZh": "演示技能",
                "description": "演示技能",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    employee_root = tmp_path / "employees"
    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_editable_skill_dir",
        lambda name, ws_id=None: skill_root,
    )
    monkeypatch.setattr(
        EmployeeService,
        "_resolve_skill_root",
        lambda: employee_root,
    )

    employee = add_employee(db_session, workspace.id, name="测试员工")
    db_session.add(
        EmployeeSkill(
            workspace_id=workspace.id,
            employee_id=employee.id,
            skill_id=local_id,
            skill_name=skill_name,
            skill_name_zh="旧名称",
            skill_description="旧描述",
        )
    )
    db_session.commit()

    count = EmployeeService.sync_local_skill_to_assignees(
        db_session,
        user_id=f"u-ws{workspace.id}",
        workspace_id=workspace.id,
        skill_name=skill_name,
    )

    assert count == 1
    row = db_session.query(EmployeeSkill).one()
    assert row.skill_name_zh == "演示技能"
    assert row.skill_description == "演示技能"
    assert (employee_root / str(employee.id) / "skills" / skill_name / "SKILL.md").is_file()


# ---------------------------------------------------------------------------
# Fix M-1: .history should NOT leak into employee copies
# ---------------------------------------------------------------------------

def test_sync_does_not_copy_history_dir(
    db_session,
    workspace,
    monkeypatch,
    tmp_path: Path,
):
    """.history 备份目录不应被复制到员工私有技能目录。"""
    skill_name = "hist-skill"
    local_id = -202
    skill_root = tmp_path / "local-skills" / str(workspace.id) / skill_name
    skill_root.mkdir(parents=True)
    (skill_root / LocalSkillService.SKILL_MD_NAME).write_text(
        "---\ndescription: 历史测试技能\n---\n# HistSkill",
        encoding="utf-8",
    )
    (skill_root / LocalSkillService.META_FILE_NAME).write_text(
        json.dumps(
            {
                "skillName": skill_name,
                "localId": local_id,
                "displayNameZh": "历史测试技能",
                "description": "历史测试技能",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    # 在 workspace 技能目录下创建 .history 备份
    history_dir = skill_root / ".history"
    history_dir.mkdir(parents=True)
    (history_dir / "20260601-100000-000000.md").write_text("# OLD", encoding="utf-8")

    employee_root = tmp_path / "employees"
    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_editable_skill_dir",
        lambda name, ws_id=None: skill_root,
    )
    monkeypatch.setattr(
        EmployeeService,
        "_resolve_skill_root",
        lambda: employee_root,
    )

    employee = add_employee(db_session, workspace.id, name="历史测试员工")
    db_session.add(
        EmployeeSkill(
            workspace_id=workspace.id,
            employee_id=employee.id,
            skill_id=local_id,
            skill_name=skill_name,
            skill_name_zh="历史测试技能",
            skill_description="历史测试技能",
        )
    )
    db_session.commit()

    EmployeeService.sync_local_skill_to_assignees(
        db_session,
        user_id=f"u-ws{workspace.id}",
        workspace_id=workspace.id,
        skill_name=skill_name,
    )

    emp_skill_dir = employee_root / str(employee.id) / "skills" / skill_name
    # SKILL.md 应存在
    assert (emp_skill_dir / LocalSkillService.SKILL_MD_NAME).is_file()
    # .history 不应存在
    assert not (emp_skill_dir / ".history").exists(), ".history 不应被复制到员工私有目录"

"""Task 6: 库编辑广播跳过已私改员工（边界 b 私有改进优先）。

员工 A — privately_modified=True → 其私有 SKILL.md 及 EmployeeSkill 行不被覆盖。
员工 B — 普通 assigned  → 被覆盖为新库内容。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService
from src.service.local_skill_service import LocalSkillService
from src.service import skill_provenance
from tests.conftest import add_employee


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

SKILL_NAME = "test-skill"
LOCAL_ID = -501
OLD_LIB_CONTENT = "# old library content"
NEW_LIB_CONTENT = "# new library content (updated)"
A_IMPROVED_CONTENT = "# A improved"


def _make_skill_dir(
    base: Path,
    *,
    skill_name: str = SKILL_NAME,
    skill_md: str = OLD_LIB_CONTENT,
    local_id: int = LOCAL_ID,
    display_name_zh: str = "测试技能",
    description: str = "测试描述",
    origin: str | None = None,
    locally_modified: bool = False,
) -> Path:
    """在 base/<skill_name> 写入标准结构，返回该目录。"""
    d = base / skill_name
    d.mkdir(parents=True, exist_ok=True)
    (d / LocalSkillService.SKILL_MD_NAME).write_text(skill_md, encoding="utf-8")
    meta: dict = {
        "skillName": skill_name,
        "localId": local_id,
        "displayNameZh": display_name_zh,
        "description": description,
        "locallyModified": locally_modified,
    }
    if origin is not None:
        meta["origin"] = origin
        meta["skillId"] = local_id
    (d / LocalSkillService.META_FILE_NAME).write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )
    return d


# ---------------------------------------------------------------------------
# fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def setup(db_session: Session, workspace, monkeypatch, tmp_path: Path):
    """
    库技能目录（新内容）+ 员工 A（私改）+ 员工 B（普通）。
    返回 (emp_a, emp_b, employee_root, lib_skill_dir)。
    """
    # --- 库技能目录（workspace library skill，内容已是新版本） ---
    lib_root = tmp_path / "local-skills" / str(workspace.id)
    lib_skill_dir = _make_skill_dir(
        lib_root,
        skill_md=NEW_LIB_CONTENT,
        display_name_zh="测试技能",
        description="测试描述",
    )

    # --- 员工根目录 ---
    employee_root = tmp_path / "employees"

    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_editable_skill_dir",
        lambda name, ws_id=None: lib_skill_dir,
    )
    monkeypatch.setattr(
        EmployeeService,
        "_resolve_skill_root",
        lambda: employee_root,
    )

    # --- 员工 A：私改版本 ---
    emp_a = add_employee(db_session, workspace.id, name="员工A")
    a_skill_dir = _make_skill_dir(
        employee_root / str(emp_a.id) / "skills",
        skill_md=A_IMPROVED_CONTENT,
        origin="assigned",
        locally_modified=True,  # 已私改
    )
    db_session.add(
        EmployeeSkill(
            workspace_id=workspace.id,
            employee_id=emp_a.id,
            skill_id=LOCAL_ID,
            skill_name=SKILL_NAME,
            skill_name_zh="测试技能",
            skill_description="测试描述",
            skill_content=A_IMPROVED_CONTENT,
        )
    )

    # --- 员工 B：普通 assigned，旧内容 ---
    emp_b = add_employee(db_session, workspace.id, name="员工B")
    _make_skill_dir(
        employee_root / str(emp_b.id) / "skills",
        skill_md=OLD_LIB_CONTENT,
        origin="assigned",
        locally_modified=False,
    )
    db_session.add(
        EmployeeSkill(
            workspace_id=workspace.id,
            employee_id=emp_b.id,
            skill_id=LOCAL_ID,
            skill_name=SKILL_NAME,
            skill_name_zh="测试技能",
            skill_description="测试描述",
            skill_content=OLD_LIB_CONTENT,
        )
    )

    db_session.commit()

    return emp_a, emp_b, employee_root, lib_skill_dir


# ---------------------------------------------------------------------------
# test
# ---------------------------------------------------------------------------

def test_sync_skips_locally_modified_assignee(setup, db_session: Session, workspace):
    """库编辑广播：已私改员工的私有磁盘与 DB 行不被覆盖，普通员工被更新。"""
    emp_a, emp_b, employee_root, _ = setup

    count = EmployeeService.sync_local_skill_to_assignees(
        db_session,
        user_id=f"u-ws{workspace.id}",
        workspace_id=workspace.id,
        skill_name=SKILL_NAME,
    )
    assert count == 2  # 两名员工均被处理（无论是否跳过覆盖）

    # --- 员工 A：磁盘内容保持原有私改内容 ---
    a_skill_md = employee_root / str(emp_a.id) / "skills" / SKILL_NAME / LocalSkillService.SKILL_MD_NAME
    assert a_skill_md.read_text(encoding="utf-8") == A_IMPROVED_CONTENT, (
        "员工 A 的私有 SKILL.md 不应被库版本覆盖"
    )

    # --- 员工 A：DB 行经由 reconcile 纠回为私有磁盘内容 ---
    row_a = (
        db_session.query(EmployeeSkill)
        .filter_by(employee_id=emp_a.id, skill_name=SKILL_NAME)
        .one()
    )
    assert row_a.skill_content == A_IMPROVED_CONTENT, (
        "员工 A 的 EmployeeSkill.skill_content 应被 reconcile 纠回为私有磁盘内容"
    )

    # --- 员工 B：磁盘内容已更新为新库内容 ---
    b_skill_md = employee_root / str(emp_b.id) / "skills" / SKILL_NAME / LocalSkillService.SKILL_MD_NAME
    assert b_skill_md.read_text(encoding="utf-8") == NEW_LIB_CONTENT, (
        "员工 B 的私有 SKILL.md 应被更新为新库内容"
    )

    # --- 员工 B：DB 行 == 新库内容 ---
    row_b = (
        db_session.query(EmployeeSkill)
        .filter_by(employee_id=emp_b.id, skill_name=SKILL_NAME)
        .one()
    )
    assert row_b.skill_content == NEW_LIB_CONTENT, (
        "员工 B 的 EmployeeSkill.skill_content 应等于新库内容"
    )


def test_sync_skips_grown_assignee(setup, db_session: Session, workspace, tmp_path: Path):
    """grown:* 来源的私有副本也不应被库版本覆盖。"""
    emp_a, _emp_b, employee_root, _ = setup

    # 将 A 的 origin 改为 grown:adopted（覆盖 .skill-meta.json）
    a_skill_dir = employee_root / str(emp_a.id) / "skills" / SKILL_NAME
    skill_provenance.write_origin(
        a_skill_dir,
        origin="grown:adopted",
        skill_id=LOCAL_ID,
        locally_modified=False,  # locallyModified=False，只靠 origin 触发跳过
    )
    # 保持 A improved 的磁盘内容
    (a_skill_dir / LocalSkillService.SKILL_MD_NAME).write_text(A_IMPROVED_CONTENT, encoding="utf-8")

    EmployeeService.sync_local_skill_to_assignees(
        db_session,
        user_id=f"u-ws{workspace.id}",
        workspace_id=workspace.id,
        skill_name=SKILL_NAME,
    )

    a_skill_md = a_skill_dir / LocalSkillService.SKILL_MD_NAME
    assert a_skill_md.read_text(encoding="utf-8") == A_IMPROVED_CONTENT, (
        "grown:* 来源的员工私有 SKILL.md 不应被库版本覆盖"
    )

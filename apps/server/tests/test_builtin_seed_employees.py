"""内置种子员工：文档办公助手、浏览器助手。"""

from __future__ import annotations

from sqlalchemy import select

from src.models.employee import Employee
from src.service.agent.paths import BUILD_IN_SKILLS_DIR
from src.service.employee_service import (
    EmployeeService,
    _BUILTIN_SEED_EMPLOYEES,
)
from src.service.local_skill_service import LocalSkillService


def _seed_names() -> set[tuple[str, frozenset[str]]]:
    return {
        (name, frozenset(skills))
        for name, skills, _desc in _BUILTIN_SEED_EMPLOYEES
    }


def test_builtin_seed_contains_office_and_browser_assistants() -> None:
    names = _seed_names()
    assert ("文档办公助手", frozenset({"docx", "pptx", "xlsx", "pdf"})) in names
    assert ("浏览器助手", frozenset({"browser-runtime"})) in names


def test_ensure_builtin_seed_creates_office_and_browser_assistants(
    db_session,
    workspace,
    tmp_path,
    monkeypatch,
) -> None:
    local_base = tmp_path / "local-skills"
    monkeypatch.setenv("LOCAL_SKILLS_PATH", str(local_base))
    from src.core.config import get_settings

    get_settings.cache_clear()

    # 隔离员工私有技能落盘根，避免污染（并读取）真实用户目录。
    skill_root = tmp_path / "employees-skills"
    monkeypatch.setattr(
        EmployeeService, "_resolve_skill_root", staticmethod(lambda: skill_root)
    )

    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_packaged_builtin_skills_root",
        lambda: BUILD_IN_SKILLS_DIR,
    )

    EmployeeService.ensure_builtin_seed_employees(db_session, "u-test", workspace.id)

    by_name: dict[str, set[str]] = {}
    for row in db_session.scalars(
        select(Employee).where(Employee.workspace_id == workspace.id)
    ).all():
        by_name[row.name] = EmployeeService._employee_skill_name_set(
            db_session, row
        )

    assert by_name["文档办公助手"] == {"docx", "pptx", "xlsx", "pdf"}
    assert by_name["浏览器助手"] == {"browser-runtime"}

"""用户级团队播种：ensure_user_team 幂等 + 新建工作空间为空项目。"""

from __future__ import annotations

from sqlalchemy import select

from src.models.employee import Employee
from src.models.workspace import Workspace


def test_ensure_user_team_seeds_curator_and_builtins(db_session, tmp_path, monkeypatch):
    from src.service.agent.paths import BUILD_IN_SKILLS_DIR
    from src.service.local_skill_service import LocalSkillService
    from src.core.config import get_settings

    monkeypatch.setenv("LOCAL_SKILLS_PATH", str(tmp_path / "local-skills"))
    get_settings.cache_clear()
    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_packaged_builtin_skills_root",
        lambda: BUILD_IN_SKILLS_DIR,
    )

    from src.service.workspace_service import WorkspaceService

    WorkspaceService.ensure_user_team(db_session, "u1")
    emps = db_session.scalars(
        select(Employee).where(Employee.user_id == "u1")
    ).all()
    assert any(e.is_curator for e in emps)  # curator seeded, user_id=u1
    assert any(e.name == "文档办公助手" for e in emps)  # builtin seeded, user_id=u1
    assert all(e.user_id == "u1" for e in emps)

    # idempotent: second call adds nothing
    before = len(emps)
    WorkspaceService.ensure_user_team(db_session, "u1")
    after = len(
        db_session.scalars(
            select(Employee).where(Employee.user_id == "u1")
        ).all()
    )
    assert after == before


def test_new_workspace_is_empty(db_session):
    # ensure_workspace_initialized must NOT seed employees
    from src.service.workspace_service import WorkspaceService

    ws = Workspace(name="proj", root_path="/tmp/proj", user_id="u9")
    db_session.add(ws)
    db_session.commit()
    WorkspaceService.ensure_workspace_initialized(db_session, ws)
    emps = db_session.scalars(
        select(Employee).where(Employee.workspace_id == ws.id)
    ).all()
    assert list(emps) == []

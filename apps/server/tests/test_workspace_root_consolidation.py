def test_ensure_default_workspace_uses_app_projects_base(db_session, monkeypatch):
    from src.service.workspace_service import WorkspaceService
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE

    # 不真建目录：patch mkdir 成 no-op
    import pathlib

    monkeypatch.setattr(pathlib.Path, "mkdir", lambda self, **k: None)
    ws = WorkspaceService.ensure_default_workspace(db_session)
    from pathlib import Path

    assert Path(ws.root_path) == APP_PROJECTS_BASE / str(ws.id)


def test_migrate_default_workspace_drive_root(db_session):
    from src.db.init_db import _migrate_default_workspace_root
    from src.models.workspace import Workspace
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    from pathlib import Path

    # 脏：盘根
    dirty = Workspace(id=1, name="默认", root_path=str(Path(Path.cwd().anchor)), user_id="1")
    db_session.add(dirty)
    db_session.commit()
    _migrate_default_workspace_root(db_session.get_bind())
    db_session.expire_all()
    assert Path(db_session.get(Workspace, 1).root_path) == APP_PROJECTS_BASE / "1"


def test_migrate_does_not_touch_app_managed_or_external(db_session):
    from src.db.init_db import _migrate_default_workspace_root
    from src.models.workspace import Workspace
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE

    app_managed = Workspace(id=2, name="ok", root_path=str(APP_PROJECTS_BASE / "2"), user_id="u")
    external = Workspace(id=3, name="ext", root_path="D:\\myproject\\sub", user_id="u")
    db_session.add_all([app_managed, external])
    db_session.commit()
    _migrate_default_workspace_root(db_session.get_bind())
    db_session.expire_all()
    assert str(APP_PROJECTS_BASE / "2") in db_session.get(Workspace, 2).root_path
    assert db_session.get(Workspace, 3).root_path == "D:\\myproject\\sub"  # 外部显式根不动

def test_ensure_default_workspace_uses_app_projects_base(db_session, monkeypatch):
    from src.service.workspace_service import WorkspaceService
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE

    # 不真建目录：patch mkdir 成 no-op
    import pathlib

    monkeypatch.setattr(pathlib.Path, "mkdir", lambda self, **k: None)
    ws = WorkspaceService.ensure_default_workspace(db_session)
    from pathlib import Path

    assert Path(ws.root_path) == APP_PROJECTS_BASE / str(ws.id)

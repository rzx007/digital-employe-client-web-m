"""SP2 Task 1.3：新建工作空间自动建托管项目目录（projects/<id>）。

- 未显式给 root_path：落到 APP_PROJECTS_BASE/<id> 并 mkdir。
- 显式给外部 root_path：原样存储，不重定位、不动其目录树。
"""

from __future__ import annotations

from pathlib import Path


def test_create_user_workspace_auto_makes_managed_dir(db_session):
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    from src.service.workspace_service import WorkspaceService

    ws = WorkspaceService.create_user_workspace(
        db_session, "u1", name="项目A", root_path=None
    )
    assert Path(ws.root_path).is_relative_to(APP_PROJECTS_BASE)
    assert Path(ws.root_path).is_dir()  # 已 mkdir


def test_create_user_workspace_explicit_external_root_kept_not_mkdird(
    db_session, tmp_path
):
    from src.service.workspace_service import WorkspaceService

    ext = tmp_path / "my-existing-repo"
    ext.mkdir()  # user's pre-existing folder
    ws = WorkspaceService.create_user_workspace(
        db_session, "u1", name="项目B", root_path=str(ext)
    )
    assert ws.root_path == str(ext)  # stored as-is, not relocated

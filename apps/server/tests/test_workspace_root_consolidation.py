def test_ensure_default_workspace_uses_app_projects_base(db_session, monkeypatch):
    from src.service.workspace_service import WorkspaceService
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE

    # 不真建目录：patch mkdir 成 no-op
    import pathlib

    monkeypatch.setattr(pathlib.Path, "mkdir", lambda self, **k: None)
    ws = WorkspaceService.ensure_default_workspace(db_session)
    from pathlib import Path

    assert Path(ws.root_path) == APP_PROJECTS_BASE / str(ws.id)


# ---- Task B1: 外部 root flat 路径解析 ----

def test_external_root_product_root_is_flat(tmp_path):
    from src.service.agent.workspace_paths import (
        resolve_workspace_product_root,
        APP_PROJECTS_BASE,
    )
    from pathlib import Path

    ext = str(tmp_path / "mycode")
    # 外部：直接是该文件夹本身，无 .boban-staff
    assert resolve_workspace_product_root(ext) == Path(ext)
    # app 托管：保持现状
    managed = str(APP_PROJECTS_BASE / "5")
    assert resolve_workspace_product_root(managed) == Path(managed)


def test_external_dirs_flat_artifacts_uploads(tmp_path):
    from src.service.agent.workspace_paths import resolve_workspace_dirs
    from pathlib import Path

    ext = str(tmp_path / "mycode")
    dirs = resolve_workspace_dirs(root_path=ext, base_dir=Path(ext))
    root = Path(ext)
    assert dirs.artifacts_dir == root and dirs.workspace_dir == root
    assert dirs.public_dir == root and dirs.public_root == root
    assert dirs.uploads_dir == root  # 平铺
    assert dirs.draft_dir == root / "skills-draft"  # draft 保持子目录(双消费者一致)


def test_app_managed_dirs_unchanged(tmp_path):
    from src.service.agent.workspace_paths import (
        resolve_workspace_dirs,
        APP_PROJECTS_BASE,
    )
    from pathlib import Path

    managed = str(APP_PROJECTS_BASE / "7")
    dirs = resolve_workspace_dirs(root_path=managed, base_dir=Path(managed))
    assert dirs.artifacts_dir == Path(managed) / "artifacts"  # 托管仍子目录
    assert dirs.uploads_dir == Path(managed) / "uploads"


def test_delete_external_workspace_does_not_rmtree(db_session, tmp_path):
    """安全关键：删外部工作空间不得触碰用户磁盘（flat 后 root 即用户整个文件夹）。"""
    import src.service.agent.workspace_paths as wp
    from src.models.workspace import Workspace
    from src.service.workspace_service import WorkspaceService

    ext = tmp_path / "user-repo"
    ext.mkdir()
    (ext / "user_file.txt").write_text("keep me")

    ws = Workspace(name="ext-del", root_path=str(ext), user_id="u1")
    db_session.add(ws)
    db_session.commit()
    ws_id = ws.id

    WorkspaceService.delete_workspace(db_session, ws_id)

    assert ext.exists()  # 外部文件夹本体不动
    assert (ext / "user_file.txt").exists()  # 用户文件存活
    assert db_session.get(Workspace, ws_id) is None  # 仅 DB 行删除


# ---- Task B2: create_user_workspace 外部自动授权 + 非空 + exists 校验 ----


def test_create_user_workspace_external_auto_grants(db_session, tmp_path):
    from src.service.workspace_service import WorkspaceService
    from src.service.authorized_dir_service import list_authorized_dirs

    ext = str(tmp_path / "repo")
    (tmp_path / "repo").mkdir()
    (tmp_path / "repo" / "existing.txt").write_text("x")  # 非空
    ws = WorkspaceService.create_user_workspace(
        db_session, user_id="u", name="ext", root_path=ext
    )
    assert ws.root_path == ext
    assert ws.auto_grant_external_dirs is True
    dirs = list_authorized_dirs(db_session, ws.id)
    assert any(ext in str(d) for d in dirs)  # 已自动授权


def test_create_user_workspace_external_missing_path_errors(db_session, tmp_path):
    from src.service.workspace_service import WorkspaceService
    import pytest

    with pytest.raises(Exception):  # 不存在 → 报错(HTTPException)
        WorkspaceService.create_user_workspace(
            db_session, user_id="u", name="x", root_path=str(tmp_path / "nope")
        )

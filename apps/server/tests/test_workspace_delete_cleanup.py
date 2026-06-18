"""删工作空间清理产物目录：托管整删 / 外部只删 .boban-staff 子目录。

安全关键：外部用户文件夹本体与用户文件必须永不被触碰（断言验证）。
托管删除测试 monkeypatch APP_PROJECTS_BASE 到 tmp_path，永不 rmtree 真实 home 下任何目录。
"""

from __future__ import annotations

import src.service.agent.workspace_paths as wp
from src.models.workspace import Workspace
from src.service.workspace_service import WorkspaceService


def test_delete_managed_workspace_removes_whole_dir(db_session, tmp_path, monkeypatch):
    fake_base = tmp_path / "projects"
    # delete_workspace 通过 workspace_paths.APP_PROJECTS_BASE 在调用时查属性，
    # patch 模块属性即可命中托管分支；同时它内部用的 resolve_workspace_product_root
    # 也读同一模块属性，故托管判定一致。
    monkeypatch.setattr(wp, "APP_PROJECTS_BASE", fake_base)
    managed = fake_base / "7"
    managed.mkdir(parents=True)
    (managed / "artifacts").mkdir()
    (managed / "artifacts" / "out.txt").write_text("x")

    ws = Workspace(id=7, name="w", root_path=str(managed), user_id="u1")
    db_session.add(ws)
    db_session.commit()

    WorkspaceService.delete_workspace(db_session, ws.id)

    assert not managed.exists()  # 托管目录整删
    assert db_session.get(Workspace, 7) is None  # DB 行也删


def test_delete_external_workspace_removes_only_subdir(db_session, tmp_path):
    ext = tmp_path / "user-repo"
    ext.mkdir()
    (ext / "user_file.txt").write_text("keep me")  # 用户自己的文件
    de = ext / ".boban-staff"
    de.mkdir()
    (de / "artifacts").mkdir()
    (de / "artifacts" / "p.txt").write_text("product")

    ws = Workspace(name="w2", root_path=str(ext), user_id="u1")
    db_session.add(ws)
    db_session.commit()
    ws_id = ws.id

    WorkspaceService.delete_workspace(db_session, ws_id)

    assert not de.exists()  # 仅 .boban-staff 子目录被删
    assert (ext / "user_file.txt").exists()  # 用户文件存活
    assert ext.exists()  # 外部根本体不动
    assert db_session.get(Workspace, ws_id) is None  # DB 行删除保留 SP1 行为


def test_delete_refuses_to_rmtree_managed_base_itself(db_session, tmp_path, monkeypatch):
    import src.service.agent.workspace_paths as wp
    from src.models.workspace import Workspace
    from src.service.workspace_service import WorkspaceService

    fake_base = tmp_path / "projects"
    monkeypatch.setattr(wp, "APP_PROJECTS_BASE", fake_base)
    fake_base.mkdir(parents=True)
    (fake_base / "other-project-stuff.txt").write_text("must survive")
    # a (malicious/corrupt) workspace whose root_path IS the managed base itself
    ws = Workspace(name="evil", root_path=str(fake_base), user_id="u1")
    db_session.add(ws)
    db_session.commit()
    WorkspaceService.delete_workspace(db_session, ws.id)
    assert fake_base.exists()  # base NOT wiped
    assert (fake_base / "other-project-stuff.txt").exists()  # siblings survive
    assert db_session.get(Workspace, ws.id) is None  # DB row still deleted

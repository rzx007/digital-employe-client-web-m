"""workspace_authorized_dir 模型测试：新表 + workspace.auto_grant_external_dirs 列。"""

from __future__ import annotations

from src.models.workspace import Workspace
from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir


def test_authorized_dir_persists_and_unique(db_session, workspace):
    row = WorkspaceAuthorizedDir(workspace_id=workspace.id, path="/tmp/foo")
    db_session.add(row)
    db_session.commit()
    got = db_session.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace.id, path="/tmp/foo"
    ).one()
    assert got.path == "/tmp/foo"
    assert got.created_at is not None


def test_workspace_has_auto_grant_default_false(db_session, workspace):
    assert workspace.auto_grant_external_dirs is False

"""workspace_authorized_dir 模型测试：新表 + workspace.auto_grant_external_dirs 列。"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from src.models.workspace import Workspace
from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir


def test_authorized_dir_persists(db_session, workspace):
    row = WorkspaceAuthorizedDir(workspace_id=workspace.id, path="/tmp/foo")
    db_session.add(row)
    db_session.commit()
    got = db_session.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace.id, path="/tmp/foo"
    ).one()
    assert got.path == "/tmp/foo"
    assert got.created_at is not None


def test_authorized_dir_unique_constraint(db_session, workspace):
    row1 = WorkspaceAuthorizedDir(workspace_id=workspace.id, path="/tmp/bar")
    row2 = WorkspaceAuthorizedDir(workspace_id=workspace.id, path="/tmp/bar")
    db_session.add(row1)
    db_session.commit()
    db_session.add(row2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_workspace_has_auto_grant_default_false(db_session, workspace):
    assert workspace.auto_grant_external_dirs is False

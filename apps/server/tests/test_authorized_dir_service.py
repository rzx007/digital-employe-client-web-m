from src.service.authorized_dir_service import (
    grant_dir,
    revoke_dir,
    list_authorized_dirs,
)


def test_grant_is_idempotent(db_session, workspace):
    grant_dir(db_session, workspace.id, "/tmp/foo")
    grant_dir(db_session, workspace.id, "/tmp/foo")  # 重复不报错
    dirs = list_authorized_dirs(db_session, workspace.id)
    assert dirs == ["/tmp/foo"]


def test_revoke(db_session, workspace):
    grant_dir(db_session, workspace.id, "/tmp/foo")
    revoke_dir(db_session, workspace.id, "/tmp/foo")
    assert list_authorized_dirs(db_session, workspace.id) == []

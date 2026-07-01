"""guard_external_write 写守卫测试（TDD）。"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import guard_external_write, set_external_dir_mode


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="写守卫测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def _ctx(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir(exist_ok=True)
    return dict(
        db=db_session, workspace_id=workspace.id, conversation_id=conversation.id,
        roots=[tmp_path / "artifacts"],
    )


def test_inside_returns_none(db_session, workspace, conversation, tmp_path):
    c = _ctx(db_session, workspace, conversation, tmp_path)
    assert guard_external_write(str(tmp_path / "artifacts" / "x.txt"), **c) is None


def test_deny_mode_rejects(db_session, workspace, conversation, tmp_path):
    set_external_dir_mode(db_session, conversation.id, "deny")
    c = _ctx(db_session, workspace, conversation, tmp_path)
    msg = guard_external_write(str(tmp_path / "other" / "x.txt"), **c)
    assert msg and "严格" in msg


def test_ask_unauthorized_points_to_request_tool(db_session, workspace, conversation, tmp_path):
    c = _ctx(db_session, workspace, conversation, tmp_path)
    msg = guard_external_write(str(tmp_path / "other" / "x.txt"), **c)
    assert msg and "request_external_dir_access" in msg


def test_auto_mode_allows(db_session, workspace, conversation, tmp_path):
    set_external_dir_mode(db_session, conversation.id, "auto")
    c = _ctx(db_session, workspace, conversation, tmp_path)
    assert guard_external_write(str(tmp_path / "other" / "x.txt"), **c) is None

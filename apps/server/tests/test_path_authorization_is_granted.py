"""is_granted 6级短路检查链 + record_grant 按scope落地 测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import is_granted, record_grant


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="授权测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def test_prefix_match_permanent(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/foo", "permanent")
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/foo/sub/x.txt") is True


def test_session_grant(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/bar", "session")
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/bar/x") is True


def test_auto_mode_grants_all(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/any", "auto")
    assert is_granted(db_session, workspace.id, conversation.id, "/somewhere/else") is True


def test_once_consumed(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/once", "once")
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/once/x") is True
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/once/y") is False  # 一次性


def test_not_granted(db_session, workspace, conversation):
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/nope") is False


def test_invalid_scope_raises(db_session, workspace, conversation):
    with pytest.raises(ValueError):
        record_grant(db_session, workspace.id, conversation.id, "/tmp/x", "bogus")

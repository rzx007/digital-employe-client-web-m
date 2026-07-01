"""/approve 按 external_dir.scope 记授权：_apply_external_dir_grant 纯函数。"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import is_granted


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="外部目录授权测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def test_apply_external_dir_grant_permanent(db_session, workspace, conversation):
    from src.service.chat_service import _apply_external_dir_grant

    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": "/tmp/foo", "scope": "permanent"},
    )
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/foo/x") is True


def test_apply_external_dir_grant_session(db_session, workspace, conversation):
    from src.service.chat_service import _apply_external_dir_grant

    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": "/tmp/bar", "scope": "session"},
    )
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/bar/y") is True


def test_apply_external_dir_grant_none_is_noop(db_session, workspace, conversation):
    from src.service.chat_service import _apply_external_dir_grant

    _apply_external_dir_grant(db_session, workspace.id, conversation.id, None)  # 不报错
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/none") is False


def test_apply_external_dir_grant_invalid_scope_ignored_or_raises(
    db_session, workspace, conversation
):
    from src.service.chat_service import _apply_external_dir_grant

    # 缺 path 或 scope → 安全 no-op（不抛，避免 approve 流崩）
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id, {"scope": "permanent"}
    )
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id, {"path": "/tmp/x"}
    )
    # 非法 scope 值也安全忽略
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": "/tmp/x", "scope": "bogus"},
    )
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/x/z") is False

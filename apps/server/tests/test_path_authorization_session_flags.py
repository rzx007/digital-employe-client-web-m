"""会话级工作区外目录写授权辅助函数测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import (
    add_once_granted_dir,
    add_session_granted_dir,
    consume_once_granted_dir,
    get_external_dir_mode,
    get_session_granted_dirs,
    set_external_dir_mode,
)


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def test_mode_default_ask(db_session, conversation):
    assert get_external_dir_mode(db_session, conversation.id) == "ask"


def test_set_mode(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "auto")
    assert get_external_dir_mode(db_session, conversation.id) == "auto"


def test_set_mode_deny(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "deny")
    assert get_external_dir_mode(db_session, conversation.id) == "deny"


def test_set_invalid_mode_raises(db_session, conversation):
    with pytest.raises(ValueError):
        set_external_dir_mode(db_session, conversation.id, "bogus")


def test_session_granted_dirs(db_session, conversation):
    add_session_granted_dir(db_session, conversation.id, "/tmp/foo")
    assert "/tmp/foo" in get_session_granted_dirs(db_session, conversation.id)


def test_session_granted_dirs_no_duplicate(db_session, conversation):
    add_session_granted_dir(db_session, conversation.id, "/tmp/foo")
    add_session_granted_dir(db_session, conversation.id, "/tmp/foo")
    dirs = get_session_granted_dirs(db_session, conversation.id)
    assert dirs.count("/tmp/foo") == 1


def test_once_token_consumed_then_gone(db_session, conversation):
    add_once_granted_dir(db_session, conversation.id, "/tmp/foo")
    # 子路径命中前缀 → 消费成功
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/foo/x.txt") is True
    # 已被移除 → 再消费失败
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/foo/y.txt") is False


def test_once_token_exact_path(db_session, conversation):
    add_once_granted_dir(db_session, conversation.id, "/tmp/bar")
    # 精确匹配（is_relative_to 自身）→ 也算命中
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/bar") is True


def test_once_token_unrelated_path_not_consumed(db_session, conversation):
    add_once_granted_dir(db_session, conversation.id, "/tmp/foo")
    # 无关路径 → 不消费
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/bar") is False
    # 令牌还在
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/foo/z.txt") is True

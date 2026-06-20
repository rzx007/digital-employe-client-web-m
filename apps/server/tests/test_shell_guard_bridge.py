"""shell 越界守卫桥测试：run_shell_guard（TDD）。

跨 session 可见性靠 patched_task_mutations_db 把 get_session_local 指向测试库，
与 test_write_guard.py 保持一致。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.write_guard_registry import (
    clear_write_guard,
    register_write_guard,
    run_shell_guard,
)


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="shell 守卫桥测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def test_run_shell_guard_fail_open_none_conv():
    """conv_id 为 None → fail-open（放行）。"""
    assert run_shell_guard("echo x > /etc/passwd", None) is None


def test_run_shell_guard_fail_open_unregistered():
    """注册表中无该 conv_id → fail-open（放行）。"""
    assert run_shell_guard("echo x > /etc/passwd", 987654) is None


def test_run_shell_guard_blocks_external(
    patched_task_mutations_db, db_session, workspace, conversation, tmp_path
):
    """命令里含工作区外绝对路径且未授权 → 返回挡回提示串（含 request_external_dir_access）。"""
    (tmp_path / "artifacts").mkdir()
    register_write_guard(
        conversation.id, [tmp_path / "artifacts"], workspace_id=workspace.id
    )
    reason = run_shell_guard(
        f'echo x > "{tmp_path}/other/evil.txt"', conversation.id
    )
    clear_write_guard(conversation.id)
    assert reason is not None
    assert "request_external_dir_access" in reason


def test_run_shell_guard_allows_internal(
    patched_task_mutations_db, db_session, workspace, conversation, tmp_path
):
    """命令里的绝对路径在授权根目录内 → 放行（返回 None）。"""
    (tmp_path / "artifacts").mkdir()
    register_write_guard(
        conversation.id, [tmp_path / "artifacts"], workspace_id=workspace.id
    )
    reason = run_shell_guard(
        f'echo x > "{tmp_path}/artifacts/ok.txt"', conversation.id
    )
    clear_write_guard(conversation.id)
    assert reason is None

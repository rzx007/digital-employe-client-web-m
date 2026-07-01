"""写守卫接线测试：write_guard_registry + run_write_guard 桥（TDD）。"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.compatible_filesystem_middleware import run_write_guard
from src.service.agent.write_guard_registry import (
    clear_write_guard,
    lookup_write_guard,
    register_write_guard,
)


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="写守卫接线测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def test_registry_roundtrip():
    register_write_guard(12345, [Path("/tmp/ws")], workspace_id=7)
    ctx = lookup_write_guard(12345)
    assert ctx and ctx.workspace_id == 7
    clear_write_guard(12345)
    assert lookup_write_guard(12345) is None


def test_run_write_guard_fail_open_when_unregistered():
    # 注册表无该会话 → fail-open（放行）
    assert (
        run_write_guard(
            "/anywhere/x", 99999, tool_call_id="t", tool_name="write_file"
        )
        is None
    )


def test_run_write_guard_fail_open_when_conv_none():
    # conv_id 取不到（None）→ fail-open（放行）
    assert (
        run_write_guard("/anywhere/x", None, tool_call_id="t", tool_name="write_file")
        is None
    )


def test_run_write_guard_blocks_external(
    patched_task_mutations_db, db_session, workspace, conversation, tmp_path
):
    (tmp_path / "artifacts").mkdir()
    register_write_guard(
        conversation.id, [tmp_path / "artifacts"], workspace_id=workspace.id
    )
    try:
        res = run_write_guard(
            str(tmp_path / "other" / "x.txt"),
            conversation.id,
            tool_call_id="t",
            tool_name="write_file",
        )
    finally:
        clear_write_guard(conversation.id)
    assert res is not None and res.status == "error"


def test_run_write_guard_allows_inside(
    patched_task_mutations_db, db_session, workspace, conversation, tmp_path
):
    (tmp_path / "artifacts").mkdir()
    register_write_guard(
        conversation.id, [tmp_path / "artifacts"], workspace_id=workspace.id
    )
    try:
        res = run_write_guard(
            str(tmp_path / "artifacts" / "x.txt"),
            conversation.id,
            tool_call_id="t",
            tool_name="write_file",
        )
    finally:
        clear_write_guard(conversation.id)
    assert res is None

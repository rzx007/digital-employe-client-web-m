"""危险操作 HITL：interrupt_on 与会话 session_flags。"""

from __future__ import annotations

import json

from src.models.conversation import Conversation
from src.service.agent.destructive_hitl import (
    DESTRUCTIVE_HITL_TOOLS,
    SKIP_DESTRUCTIVE_HITL_FLAG,
    build_orchestrator_interrupt_on,
    get_session_flags,
    set_skip_destructive_hitl,
)
from src.service.hitl_pending_parts import (
    HITL_TOOL_NAMES,
    build_pending_hitl_parts,
)


def test_build_orchestrator_interrupt_on_includes_destructive_tools():
    interrupt_on = build_orchestrator_interrupt_on(None)
    for name in DESTRUCTIVE_HITL_TOOLS:
        assert name in interrupt_on
        assert interrupt_on[name]["allowed_decisions"] == ["approve", "reject"]


def test_build_orchestrator_interrupt_on_skips_when_session_flag_set():
    interrupt_on = build_orchestrator_interrupt_on(
        {SKIP_DESTRUCTIVE_HITL_FLAG: True}
    )
    for name in DESTRUCTIVE_HITL_TOOLS:
        assert name not in interrupt_on
    assert "submit_clarifying_questions" in interrupt_on
    assert "submit_document_plan" in interrupt_on


def test_set_skip_destructive_hitl_persists_flags(db_session, workspace):
    conversation = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="总管",
    )
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)

    set_skip_destructive_hitl(db_session, conversation.id, True)
    db_session.commit()
    db_session.refresh(conversation)

    flags = json.loads(conversation.session_flags or "{}")
    assert flags[SKIP_DESTRUCTIVE_HITL_FLAG] is True
    assert get_session_flags(db_session, conversation.id) == flags


def test_hitl_pending_parts_recognizes_delete_tasks_batch():
    assert "delete_tasks_batch" in HITL_TOOL_NAMES

    parts = build_pending_hitl_parts(
        [{"name": "delete_tasks_batch", "args": {"task_ids": "[1,2]"}}],
        "call-delete-batch",
        stream_msg_id=99,
    )
    assert len(parts) == 1
    assert parts[0]["type"] == "tool-delete_tasks_batch"
    assert parts[0]["state"] == "input-available"
    assert parts[0]["input"]["task_ids"] == "[1,2]"

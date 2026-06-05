"""覆盖范围：组长 brief 构建、HITL interrupt_on 配置、中断澄清消息投影到群时间线。"""

from __future__ import annotations

import json

from sqlalchemy import select

from src.models.conversation import Conversation, ConversationMessage
from src.models.group_room import GroupRoom
from src.service.group_room_service import (
    build_leader_brief,
    project_member_conversation_if_in_room,
)
from src.service.agent.destructive_hitl import build_orchestrator_interrupt_on


def test_leader_brief_includes_clarify_branch() -> None:
    brief = build_leader_brief(question="帮我写个文档", roster="- 张三（员工ID: 1）")
    assert "submit_clarifying_questions" in brief
    assert "模糊" in brief or "信息不足" in brief
    assert "帮我写个文档" in brief
    assert "张三" in brief


def test_orchestrator_interrupt_on_has_clarify() -> None:
    interrupt_on = build_orchestrator_interrupt_on(None)
    assert "submit_clarifying_questions" in interrupt_on
    assert "respond" in interrupt_on["submit_clarifying_questions"]["allowed_decisions"]


def test_orchestrator_interrupt_on_skip_flag_does_not_remove_clarify() -> None:
    """传 skip_destructive_hitl=True 仍含 submit_clarifying_questions。"""
    interrupt_on = build_orchestrator_interrupt_on({"skip_destructive_hitl": True})
    assert "submit_clarifying_questions" in interrupt_on
    assert "respond" in interrupt_on["submit_clarifying_questions"]["allowed_decisions"]


def _make_room_with_leader(db_session, workspace):
    group_conv = Conversation(
        workspace_id=workspace.id, target_type="group", target_id=1, title="群"
    )
    db_session.add(group_conv)
    db_session.flush()
    leader_conv = Conversation(
        workspace_id=workspace.id,
        target_type="group_leader",
        target_id=group_conv.id,
        title="组长",
    )
    db_session.add(leader_conv)
    db_session.flush()
    room = GroupRoom(
        workspace_id=workspace.id,
        room_conversation_id=group_conv.id,
        leader_conversation_id=leader_conv.id,
    )
    db_session.add(room)
    db_session.commit()
    return room, group_conv, leader_conv


def test_interrupted_leader_projects_clarify_card(
    db_session, db_engine, workspace, monkeypatch
):
    from sqlalchemy.orm import sessionmaker

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    parts = [{"type": "clarifying_questions", "questions": ["主题?", "受众?"]}]
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id,
        role="assistant",
        content="",
        stream_state="interrupted",
        message_parts=json.dumps(parts, ensure_ascii=False),
    )
    db_session.add(interrupted)
    db_session.commit()
    interrupted_id = interrupted.id

    project_member_conversation_if_in_room(leader_conv.id, "interrupted")

    read = TestSession()
    card = read.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == group_conv.id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is not None
    meta = json.loads(card.extra_meta or "{}")
    assert meta["clarify_target_conversation_id"] == leader_conv.id
    assert meta["clarify_message_id"] == interrupted_id
    assert "clarifying_questions" in (card.message_parts or "")
    read.close()

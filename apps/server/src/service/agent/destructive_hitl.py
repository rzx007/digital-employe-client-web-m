from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON

DESTRUCTIVE_HITL_TOOLS: frozenset[str] = frozenset({
    "delete_employee",
    "delete_task",
    "delete_tasks_batch",
})

DESTRUCTIVE_HITL_INTERRUPT_ON: dict[str, dict[str, list[str]]] = {
    name: {"allowed_decisions": ["approve", "reject"]}
    for name in DESTRUCTIVE_HITL_TOOLS
}

SKIP_DESTRUCTIVE_HITL_FLAG = "skip_destructive_hitl"


def build_orchestrator_interrupt_on(session_flags: dict[str, Any] | None) -> dict:
    """合并澄清/方案 HITL 与删除类 tool；会话已 opt-out 时移除删除类 interrupt。"""
    merged = {**HITL_INTERRUPT_ON, **DESTRUCTIVE_HITL_INTERRUPT_ON}
    if session_flags and session_flags.get(SKIP_DESTRUCTIVE_HITL_FLAG):
        for name in DESTRUCTIVE_HITL_TOOLS:
            merged.pop(name, None)
    return merged


def parse_session_flags(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_session_flags(db: Session, conversation_id: int) -> dict[str, Any]:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        return {}
    return parse_session_flags(conversation.session_flags)


def set_skip_destructive_hitl(
    db: Session,
    conversation_id: int,
    skip: bool,
) -> None:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        return
    flags = parse_session_flags(conversation.session_flags)
    if skip:
        flags[SKIP_DESTRUCTIVE_HITL_FLAG] = True
    else:
        flags.pop(SKIP_DESTRUCTIVE_HITL_FLAG, None)
    conversation.session_flags = (
        json.dumps(flags, ensure_ascii=False) if flags else None
    )
    db.add(conversation)

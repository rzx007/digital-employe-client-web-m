from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.clarifying_questions_tool import (
    CLARIFYING_QUESTIONS_INTERRUPT_ON,
)
from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON

DESTRUCTIVE_HITL_TOOLS: frozenset[str] = frozenset({
    "delete_employee",
    "delete_employees_batch",
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


def resolve_orchestrator_interrupt_on(
    *,
    enable_hitl: bool,
    clarify_only_hitl: bool,
    session_flags: dict[str, Any] | None,
) -> dict | None:
    """决定 orchestrator 挂哪些 HITL 中断（None = 完全不挂 HITL 中间件）。

    三态：
    - enable_hitl：真人会话，全量 HITL（澄清/方案/删除，受 skip_destructive 标志影响）。
    - clarify_only_hitl：群组长——删除/文档方案无审批者照常关，但「澄清问题」有群澄清
      卡片 + 普通消息兜底两条 resume 通路，必须开。只挂 submit_clarifying_questions，
      组长遇模糊需求时真正挂起等用户作答，而非让工具直接返回「已收到回答」串致误判。
    - 都为假（如组长汇总）：无需澄清也无审批者，全关。
    """
    if enable_hitl:
        return build_orchestrator_interrupt_on(session_flags)
    if clarify_only_hitl:
        return dict(CLARIFYING_QUESTIONS_INTERRUPT_ON)
    return None


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

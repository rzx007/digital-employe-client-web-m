"""Fallback token usage when the model API omits usage_metadata in stream chunks."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.conversation import ConversationMessage

logger = logging.getLogger(__name__)

# Rough system prompt + tool schema overhead per agent turn.
_DEFAULT_SYSTEM_OVERHEAD_TOKENS = 3500


def estimate_text_tokens(text: str) -> int:
    """Estimate token count for mixed CJK/Latin text."""
    if not text:
        return 0
    try:
        import tiktoken

        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        # CJK-heavy corpora: ~1.5–2 chars per token
        return max(1, len(text) // 2)


def _extract_text_from_message_parts(message_parts_json: str | None) -> str:
    if not message_parts_json:
        return ""
    try:
        parts = json.loads(message_parts_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(parts, list):
        return ""

    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        part_type = part.get("type")
        if part_type == "text":
            text = part.get("text") or part.get("content")
            if isinstance(text, str) and text.strip():
                chunks.append(text)
            continue
        if isinstance(part_type, str) and part_type.startswith("tool-"):
            for key in ("content", "output", "result", "text"):
                val = part.get(key)
                if isinstance(val, str) and val.strip():
                    chunks.append(val)
                    break
            continue
        content = part.get("content")
        if isinstance(content, str) and content.strip():
            chunks.append(content)
    return "\n".join(chunks)


def _collect_conversation_texts(
    db: Session,
    conversation_id: int,
    *,
    exclude_message_id: int | None = None,
    limit: int = 80,
) -> list[str]:
    stmt = (
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.id.asc())
    )
    if exclude_message_id is not None:
        stmt = stmt.where(ConversationMessage.id != exclude_message_id)
    messages = list(db.scalars(stmt).all())
    if len(messages) > limit:
        messages = messages[-limit:]

    texts: list[str] = []
    for message in messages:
        if message.content and message.content.strip():
            texts.append(message.content.strip())
        if message.message_parts:
            parts_text = _extract_text_from_message_parts(message.message_parts)
            if parts_text.strip():
                texts.append(parts_text.strip())
    return texts


def estimate_usage_for_conversation_turn(
    db: Session,
    *,
    conversation_id: int,
    stream_msg_id: int,
    assistant_content: str | None,
    message_parts_json: str | None,
    system_overhead_tokens: int = _DEFAULT_SYSTEM_OVERHEAD_TOKENS,
) -> dict[str, Any] | None:
    """Estimate last-turn usage from persisted history + current assistant output."""
    history_texts = _collect_conversation_texts(
        db,
        conversation_id,
        exclude_message_id=stream_msg_id,
    )
    parts_text = _extract_text_from_message_parts(message_parts_json)
    output_text = (assistant_content or "").strip()
    if parts_text.strip():
        output_text = f"{parts_text}\n{output_text}".strip()

    if not history_texts and not output_text:
        return None

    prompt_text = "\n".join(history_texts)
    input_tokens = (
        estimate_text_tokens(prompt_text) + system_overhead_tokens
    )
    output_tokens = estimate_text_tokens(output_text)
    if input_tokens <= 0 and output_tokens <= 0:
        return None

    return {
        "input_tokens": max(input_tokens, 1),
        "output_tokens": max(output_tokens, 0),
        "estimated": True,
    }


def estimate_usage_for_conversation_turn_sync(
    conversation_id: int,
    stream_msg_id: int,
    assistant_content: str | None,
    message_parts_json: str | None,
) -> dict[str, Any] | None:
    from src.db.session import sqlite_db_session

    with sqlite_db_session() as db:
        return estimate_usage_for_conversation_turn(
            db,
            conversation_id=conversation_id,
            stream_msg_id=stream_msg_id,
            assistant_content=assistant_content,
            message_parts_json=message_parts_json,
        )

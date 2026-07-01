"""Fallback token usage when the model API omits usage_metadata in stream chunks."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.conversation import ConversationMessage
from src.service.basic_file_reader import IMAGE_EXTENSIONS

logger = logging.getLogger(__name__)

# Rough system prompt + tool schema overhead per agent turn.
_DEFAULT_SYSTEM_OVERHEAD_TOKENS = 3500

# Flat per-image token cost (hermes-agent / Anthropic pricing model). Images
# are sent as image blocks at runtime but stored only as file references, so
# the text estimate would otherwise miss them and undercount vision turns.
# Counting raw base64 chars would massively overcount, so use a flat figure.
_IMAGE_TOKEN_COST = 1500


def _count_referenced_images(extra_meta: str | None) -> int:
    """Count image files referenced in a message's extra_meta.files by extension."""
    if not extra_meta:
        return 0
    try:
        meta = json.loads(extra_meta)
    except (json.JSONDecodeError, TypeError):
        return 0
    files = meta.get("files") if isinstance(meta, dict) else None
    if not isinstance(files, list):
        return 0
    count = 0
    for item in files:
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        if not isinstance(path, str):
            continue
        suffix = path[path.rfind(".") :].lower() if "." in path else ""
        if suffix in IMAGE_EXTENSIONS:
            count += 1
    return count


def _get_tiktoken_encoding(name: str = "cl100k_base"):
    """Return a tiktoken encoding, or None if tiktoken is unavailable.

    Isolated as a seam so the fallback path can be tested without uninstalling
    tiktoken.
    """
    import tiktoken

    return tiktoken.get_encoding(name)


def _is_cjk(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x4E00 <= cp <= 0x9FFF  # CJK Unified Ideographs
        or 0x3040 <= cp <= 0x30FF  # Hiragana + Katakana
        or 0xAC00 <= cp <= 0xD7A3  # Hangul syllables
        or 0xFF00 <= cp <= 0xFFEF  # Fullwidth forms
    )


def _fallback_token_estimate(text: str) -> int:
    """Approximate tokens without tiktoken.

    cl100k_base encodes English/code at ~4 chars/token and CJK at ~1.5
    chars/token. The previous flat len//2 over-counted ASCII by ~2.4x, which
    was a primary cause of wildly inflated estimates. Split the text by script
    and apply each ratio.
    """
    cjk_chars = sum(1 for ch in text if _is_cjk(ch))
    other_chars = len(text) - cjk_chars
    tokens = cjk_chars / 1.5 + other_chars / 4.0
    return max(1, int(tokens))


def estimate_text_tokens(text: str) -> int:
    """Estimate token count for mixed CJK/Latin text."""
    if not text:
        return 0
    try:
        enc = _get_tiktoken_encoding("cl100k_base")
        if enc is not None:
            return len(enc.encode(text))
    except Exception:
        pass
    return _fallback_token_estimate(text)


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


# Per-message cap on historical tool-output text folded into the INPUT
# estimate. The running agent truncates old tool args at ~50% budget and
# head/tail-drops the middle before each LLM call, so the full multi-hundred-KB
# tool dump persisted in message_parts is NOT what gets resent. Counting it
# verbatim across the whole history was the main "估算值离谱" driver; clamp each
# message's tool-output contribution to a modest slice instead.
_HISTORY_TOOL_OUTPUT_CHAR_CAP = 4000


def _collect_conversation_texts(
    db: Session,
    conversation_id: int,
    *,
    exclude_message_id: int | None = None,
    limit: int = 80,
) -> tuple[list[str], int]:
    """Return (history texts, total referenced-image count) for the estimate."""
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
    image_count = 0
    for message in messages:
        if message.content and message.content.strip():
            texts.append(message.content.strip())
        if message.message_parts:
            parts_text = _extract_text_from_message_parts(message.message_parts)
            parts_text = parts_text.strip()
            if parts_text:
                texts.append(parts_text[:_HISTORY_TOOL_OUTPUT_CHAR_CAP])
        image_count += _count_referenced_images(
            getattr(message, "extra_meta", None)
        )
    return texts, image_count


def estimate_usage_for_conversation_turn(
    db: Session,
    *,
    conversation_id: int,
    stream_msg_id: int,
    assistant_content: str | None,
    message_parts_json: str | None,
    system_overhead_tokens: int = _DEFAULT_SYSTEM_OVERHEAD_TOKENS,
    max_input_tokens: int | None = None,
) -> dict[str, Any] | None:
    """Estimate last-turn usage from persisted history + current assistant output."""
    history_texts, image_count = _collect_conversation_texts(
        db,
        conversation_id,
        exclude_message_id=stream_msg_id,
    )
    parts_text = _extract_text_from_message_parts(message_parts_json)
    output_text = (assistant_content or "").strip()
    if parts_text.strip():
        output_text = f"{parts_text}\n{output_text}".strip()

    if not history_texts and not output_text and image_count == 0:
        return None

    prompt_text = "\n".join(history_texts)
    input_tokens = (
        estimate_text_tokens(prompt_text)
        + system_overhead_tokens
        + image_count * _IMAGE_TOKEN_COST
    )
    output_tokens = estimate_text_tokens(output_text)
    if input_tokens <= 0 and output_tokens <= 0:
        return None

    # Never report more input than the model could physically accept — the
    # agent compresses/truncates before overflowing the window, so an estimate
    # above the ceiling is meaningless and renders as a >100% ring.
    if max_input_tokens is not None and max_input_tokens > 0:
        input_tokens = min(input_tokens, max_input_tokens)

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

    max_input_tokens: int | None = None
    try:
        from src.core.config import get_settings
        from src.service.model_context import resolve_max_input_tokens

        max_input_tokens = resolve_max_input_tokens(get_settings())
    except Exception:
        max_input_tokens = None

    with sqlite_db_session() as db:
        return estimate_usage_for_conversation_turn(
            db,
            conversation_id=conversation_id,
            stream_msg_id=stream_msg_id,
            assistant_content=assistant_content,
            message_parts_json=message_parts_json,
            max_input_tokens=max_input_tokens,
        )

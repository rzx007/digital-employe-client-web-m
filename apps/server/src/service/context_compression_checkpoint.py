"""Checkpoint-style context compaction triggers (delegation done, topic change)."""

from __future__ import annotations

import logging
import re
import threading
from typing import Literal

logger = logging.getLogger(__name__)

CompactReason = Literal[
    "delegation_completed",
    "topic_change",
    "user_requested",
]

_lock = threading.Lock()
_pending: dict[int, CompactReason] = {}

_TOPIC_CHANGE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"换个话题"),
    re.compile(r"新任务"),
    re.compile(r"重新开始"),
    re.compile(r"重新来"),
    re.compile(r"不管(上面|之前|刚才)"),
    re.compile(r"忘掉之前"),
    re.compile(r"另起一个"),
    re.compile(r"下一个任务"),
)


def mark_pending_compact(conversation_id: int, reason: CompactReason) -> None:
    """Schedule compaction on the next model call for this conversation."""
    with _lock:
        _pending[int(conversation_id)] = reason
    logger.info(
        "context compact checkpoint scheduled: conv=%s reason=%s",
        conversation_id,
        reason,
    )


def consume_pending_compact(conversation_id: int) -> CompactReason | None:
    """Take and clear a pending compaction flag, if any."""
    with _lock:
        return _pending.pop(int(conversation_id), None)


def detect_topic_change_checkpoint(
    question: str,
    extra_meta: dict | None = None,
) -> CompactReason | None:
    """Heuristic: user explicitly switches topic or requests compact via meta."""
    if extra_meta:
        if extra_meta.get("checkpoint_compact") or extra_meta.get("topic_change"):
            return "user_requested"
    text = (question or "").strip()
    if not text:
        return None
    for pattern in _TOPIC_CHANGE_PATTERNS:
        if pattern.search(text):
            return "topic_change"
    return None


def resolve_checkpoint_compact_reason(
    conversation_id: int,
    question: str,
    extra_meta: dict | None = None,
) -> CompactReason | None:
    """Pending delegation checkpoint wins; else topic-change heuristics."""
    pending = consume_pending_compact(conversation_id)
    if pending is not None:
        return pending
    return detect_topic_change_checkpoint(question, extra_meta)

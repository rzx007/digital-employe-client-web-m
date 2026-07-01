"""Conversation context budget snapshot for UI observability."""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.conversation import ConversationMessage
from src.service.context_compression import DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION
from src.service.model_context import (
    resolve_max_input_tokens,
    resolve_summarization_token_threshold,
)

logger = logging.getLogger(__name__)

ContextBudgetZone = Literal[
    "unknown",
    "ok",
    "truncate_args",
    "near_summarize",
    "at_summarize",
]

ZONE_LABELS: dict[ContextBudgetZone, str] = {
    "unknown": "暂无用量",
    "ok": "正常",
    "truncate_args": "将截断旧工具参数",
    "near_summarize": "接近摘要阈值",
    "at_summarize": "已达摘要线，下轮将压缩",
}


class ContextBudgetRead(BaseModel):
    conversation_id: int
    last_input_tokens: int | None = None
    last_output_tokens: int | None = None
    max_input_tokens: int
    summarization_threshold: int = Field(
        description="LLM 摘要触发线（max × trigger_fraction）"
    )
    truncate_args_threshold: int = Field(
        description="旧 tool 参数截断线（max × 0.50）"
    )
    head_tail_skip_threshold: int = Field(
        description="跳过 DB head/tail 无脑丢中间的线（摘要阈值 × 0.80）"
    )
    usage_percent_of_max: float | None = Field(
        None,
        description="last_input / max_input × 100",
    )
    usage_percent_of_summarize: float | None = Field(
        None,
        description="last_input / summarization_threshold × 100",
    )
    zone: ContextBudgetZone = "unknown"
    zone_label: str = "暂无用量"
    source: Literal["api_usage", "estimated", "none"] = "none"
    last_message_id: int | None = None


def _parse_usage(extra_meta: str | None) -> dict[str, Any] | None:
    if not extra_meta:
        return None
    try:
        meta = json.loads(extra_meta)
    except (json.JSONDecodeError, TypeError):
        return None
    usage = meta.get("usage")
    return usage if isinstance(usage, dict) else None


def _resolve_zone(
    last_input: int | None,
    *,
    max_input: int,
    summarize_threshold: int,
    truncate_threshold: int,
) -> ContextBudgetZone:
    if last_input is None or last_input <= 0:
        return "unknown"
    if last_input >= summarize_threshold:
        return "at_summarize"
    head_tail_skip = int(summarize_threshold * 0.80)
    if last_input >= head_tail_skip:
        return "near_summarize"
    if last_input >= truncate_threshold:
        return "truncate_args"
    return "ok"


def resolve_context_budget_for_conversation(
    db: Session,
    conversation_id: int,
) -> ContextBudgetRead:
    """Build context usage snapshot for one conversation."""
    settings = get_settings()
    max_input = resolve_max_input_tokens(settings)
    summarize_threshold = resolve_summarization_token_threshold(settings)
    truncate_threshold = int(max_input * DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION)
    head_tail_skip = int(summarize_threshold * 0.80)

    stmt = (
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation_id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
        .limit(50)
    )
    messages = list(db.scalars(stmt).all())

    last_input: int | None = None
    last_output: int | None = None
    last_message_id: int | None = None
    source: Literal["api_usage", "estimated", "none"] = "none"
    for message in messages:
        usage = _parse_usage(message.extra_meta)
        if not usage:
            continue
        raw_in = usage.get("input_tokens")
        if raw_in is None:
            continue
        try:
            last_input = int(raw_in)
        except (TypeError, ValueError):
            continue
        last_message_id = message.id
        raw_out = usage.get("output_tokens")
        if raw_out is not None:
            try:
                last_output = int(raw_out)
            except (TypeError, ValueError):
                last_output = None
        source = "estimated" if usage.get("estimated") else "api_usage"
        break

    zone = _resolve_zone(
        last_input,
        max_input=max_input,
        summarize_threshold=summarize_threshold,
        truncate_threshold=truncate_threshold,
    )
    usage_pct_max = (
        round(last_input / max_input * 100, 1) if last_input is not None else None
    )
    usage_pct_summarize = (
        round(last_input / summarize_threshold * 100, 1)
        if last_input is not None and summarize_threshold > 0
        else None
    )

    return ContextBudgetRead(
        conversation_id=conversation_id,
        last_input_tokens=last_input,
        last_output_tokens=last_output,
        max_input_tokens=max_input,
        summarization_threshold=summarize_threshold,
        truncate_args_threshold=truncate_threshold,
        head_tail_skip_threshold=head_tail_skip,
        usage_percent_of_max=usage_pct_max,
        usage_percent_of_summarize=usage_pct_summarize,
        zone=zone,
        zone_label=ZONE_LABELS[zone],
        source=source,
        last_message_id=last_message_id,
    )

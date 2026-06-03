"""Tests for head/tail vs summarization coordination."""

from types import SimpleNamespace

from src.service.chat_service import ChatService
from src.service.model_context import (
    resolve_summarization_token_threshold,
    should_apply_head_tail_truncation,
)


def test_should_skip_head_tail_near_summarization_threshold() -> None:
    settings = SimpleNamespace(
        model_max_input_tokens=100_000,
        summarization_trigger_fraction=0.75,
        chat_history_max_messages=30,
    )
    threshold = resolve_summarization_token_threshold(settings)  # type: ignore[arg-type]
    high_usage = int(threshold * 0.85)
    assert should_apply_head_tail_truncation(settings, high_usage) is False  # type: ignore[arg-type]
    assert should_apply_head_tail_truncation(settings, 1000) is True  # type: ignore[arg-type]


def test_resolve_effective_history_limit_keeps_full_window_near_threshold() -> None:
    settings = SimpleNamespace(
        model_max_input_tokens=100_000,
        summarization_trigger_fraction=0.75,
        chat_history_max_messages=30,
    )
    threshold = resolve_summarization_token_threshold(settings)  # type: ignore[arg-type]
    limit = ChatService._resolve_effective_history_limit(
        settings,  # type: ignore[arg-type]
        int(threshold * 0.85),
    )
    assert limit == 30


def test_resolve_effective_history_limit_halves_in_mid_band() -> None:
    settings = SimpleNamespace(
        model_max_input_tokens=100_000,
        summarization_trigger_fraction=0.75,
        chat_history_max_messages=30,
    )
    threshold = resolve_summarization_token_threshold(settings)  # type: ignore[arg-type]
    limit = ChatService._resolve_effective_history_limit(
        settings,  # type: ignore[arg-type]
        int(threshold * 0.65),
    )
    assert limit == 15

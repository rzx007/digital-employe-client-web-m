"""Tests for unified context compression settings."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from src.service.context_compression import (
    DEFAULT_TRUNCATE_ARGS_MAX_LENGTH,
    DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION,
    build_summarization_middleware_stack,
    resolve_truncate_args_settings,
)


def test_resolve_truncate_args_settings() -> None:
    settings = SimpleNamespace(summarization_keep_fraction=0.20)
    cfg = resolve_truncate_args_settings(settings)  # type: ignore[arg-type]
    assert cfg["trigger"] == ("fraction", DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION)
    assert cfg["keep"] == ("fraction", 0.20)
    assert cfg["max_length"] == DEFAULT_TRUNCATE_ARGS_MAX_LENGTH
    assert "truncated" in cfg["truncation_text"]


def test_build_summarization_middleware_stack_enables_truncate_args() -> None:
    settings = SimpleNamespace(
        summarization_trigger_fraction=0.75,
        summarization_keep_fraction=0.20,
    )
    model = MagicMock()
    model.profile = {"max_input_tokens": 131072}
    backend = MagicMock()
    summarization_mw, tool_mw = build_summarization_middleware_stack(
        model=model,
        backend=backend,
        settings=settings,  # type: ignore[arg-type]
        use_session_history_file=True,
    )
    assert summarization_mw.use_session_history_file is True
    assert summarization_mw._truncate_args_trigger == (
        "fraction",
        DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION,
    )
    assert tool_mw is not None

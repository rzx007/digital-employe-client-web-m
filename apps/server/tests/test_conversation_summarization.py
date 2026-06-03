"""Tests for ConversationSummarizationMiddleware compression hooks."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain_core.messages import HumanMessage

from src.service.conversation_summarization import ConversationSummarizationMiddleware


def _middleware() -> ConversationSummarizationMiddleware:
    model = MagicMock()
    model.profile = {"max_input_tokens": 100_000}
    backend = MagicMock()
    return ConversationSummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=("fraction", 0.75),
        keep=("fraction", 0.20),
    )


def test_should_summarize_force_checkpoint() -> None:
    mw = _middleware()
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={"force_context_compact": True, "context_compact_reason": "topic_change"},
    ):
        assert mw._should_summarize([], 1000) is True


def test_should_summarize_api_usage_over_threshold() -> None:
    mw = _middleware()
    settings = SimpleNamespace(
        model_max_input_tokens=100_000,
        summarization_trigger_fraction=0.75,
    )
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={"last_reported_input_tokens": 80_000},
    ), patch(
        "src.service.conversation_summarization.get_settings",
        return_value=settings,
    ), patch.object(
        ConversationSummarizationMiddleware.__bases__[0],
        "_should_summarize",
        return_value=False,
    ):
        assert mw._should_summarize([], 1000) is True


def test_should_summarize_delegates_when_under_threshold() -> None:
    mw = _middleware()
    with patch.object(mw, "_read_run_configurable", return_value={}), patch.object(
        ConversationSummarizationMiddleware.__bases__[0],
        "_should_summarize",
        return_value=False,
    ) as parent:
        assert mw._should_summarize([HumanMessage(content="hi")], 100) is False
        parent.assert_called_once()

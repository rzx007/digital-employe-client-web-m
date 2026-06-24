"""Tests for ConversationSummarizationMiddleware compression hooks."""

from types import SimpleNamespace
from typing import get_type_hints
from unittest.mock import MagicMock, patch

from langchain_core.messages import HumanMessage

from src.service.conversation_summarization import (
    ConversationSummarizationMiddleware,
    ConversationSummarizationToolMiddleware,
    _PatchedSummarizationState,
    _merge_summarization_event,
)


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


def _event(cutoff: int) -> dict:
    return {
        "cutoff_index": cutoff,
        "summary_message": HumanMessage(content=f"sum@{cutoff}"),
        "file_path": None,
    }


def test_merge_summarization_event_prefers_higher_cutoff() -> None:
    left = _event(10)
    right = _event(25)
    assert _merge_summarization_event(left, right) is right
    assert _merge_summarization_event(right, left) is right


def test_merge_summarization_event_handles_none_sides() -> None:
    e = _event(5)
    assert _merge_summarization_event(None, None) is None
    assert _merge_summarization_event(e, None) is e
    assert _merge_summarization_event(None, e) is e


def test_merge_summarization_event_equal_cutoff_takes_right() -> None:
    # Stable tie-break on "right wins" lets the second concurrent writer in the
    # superstep replace an identical-cutoff event without ping-pong.
    left = _event(7)
    right = _event(7)
    assert _merge_summarization_event(left, right) is right


def test_patched_state_attaches_reducer_as_last_metadata() -> None:
    # langgraph._is_field_binop scans Annotated.__metadata__[-1] for a 2-arg
    # callable to register as the field reducer. If this assert breaks, the
    # concurrent-update guard is silently disabled and INVALID_CONCURRENT_GRAPH_UPDATE
    # comes back.
    hints = get_type_hints(_PatchedSummarizationState, include_extras=True)
    field = hints["_summarization_event"]
    assert hasattr(field, "__metadata__"), field
    assert field.__metadata__[-1] is _merge_summarization_event


def test_middlewares_use_patched_state_schema() -> None:
    assert ConversationSummarizationMiddleware.state_schema is _PatchedSummarizationState
    assert ConversationSummarizationToolMiddleware.state_schema is _PatchedSummarizationState

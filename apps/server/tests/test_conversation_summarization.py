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


def test_force_compact_user_requested_is_unconditional() -> None:
    # Explicit "start over / new topic" intent compacts even on a tiny context.
    mw = _middleware()
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={
            "force_context_compact": True,
            "context_compact_reason": "user_requested",
        },
    ):
        assert mw._should_summarize([], 1000) is True


def test_force_compact_checkpoint_skipped_when_context_small() -> None:
    # delegation_completed / topic_change checkpoints fire often (orchestrator
    # marks one after every finished sub-task). On a small context, honoring it
    # would churn the cache and spam summaries — gate it below 0.5*threshold.
    mw = _middleware()
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={
            "force_context_compact": True,
            "context_compact_reason": "delegation_completed",
        },
    ), patch(
        "src.service.conversation_summarization.get_settings",
        return_value=_settings(),
    ), patch.object(
        ConversationSummarizationMiddleware.__bases__[0],
        "_should_summarize",
        return_value=False,
    ):
        # threshold=75_000, floor=37_500; 1_000 is well below -> not forced.
        assert mw._should_summarize([], 1_000) is False


def test_force_compact_checkpoint_honored_when_context_large() -> None:
    mw = _middleware()
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={
            "force_context_compact": True,
            "context_compact_reason": "delegation_completed",
        },
    ), patch(
        "src.service.conversation_summarization.get_settings",
        return_value=_settings(),
    ):
        # 60_000 >= floor 37_500 -> checkpoint compaction proceeds.
        assert mw._should_summarize([], 60_000) is True


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        model_max_input_tokens=100_000,
        summarization_trigger_fraction=0.75,
    )


def test_should_summarize_api_usage_corroborated_by_live_size() -> None:
    # threshold=75_000, pre_trigger=69_000. API report AND current approximate
    # are both above the trigger band -> context genuinely large, compress.
    mw = _middleware()
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={"last_reported_input_tokens": 80_000},
    ), patch(
        "src.service.conversation_summarization.get_settings",
        return_value=_settings(),
    ), patch.object(
        ConversationSummarizationMiddleware.__bases__[0],
        "_should_summarize",
        return_value=False,
    ):
        assert mw._should_summarize([], 80_000) is True


def test_should_summarize_stale_peak_not_forced_when_context_small() -> None:
    # Regression for the repeated-compression loop: last_reported is the previous
    # turn's stored PEAK and can stay >= threshold even right after a compaction
    # (large orchestrator system prompt). With the live context now tiny
    # (total_tokens=1_000), we must NOT re-summarize on the stale peak alone —
    # otherwise every subsequent turn re-compresses forever.
    mw = _middleware()
    with patch.object(
        mw,
        "_read_run_configurable",
        return_value={"last_reported_input_tokens": 80_000},
    ), patch(
        "src.service.conversation_summarization.get_settings",
        return_value=_settings(),
    ), patch.object(
        ConversationSummarizationMiddleware.__bases__[0],
        "_should_summarize",
        return_value=False,
    ) as parent:
        assert mw._should_summarize([HumanMessage(content="hi")], 1_000) is False
        parent.assert_called_once()


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

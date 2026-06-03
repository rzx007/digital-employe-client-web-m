"""Tests for checkpoint-style context compaction triggers."""

from src.service.context_compression_checkpoint import (
    consume_pending_compact,
    detect_topic_change_checkpoint,
    mark_pending_compact,
    resolve_checkpoint_compact_reason,
)


def test_mark_and_consume_pending_compact() -> None:
    mark_pending_compact(9001, "delegation_completed")
    assert consume_pending_compact(9001) == "delegation_completed"
    assert consume_pending_compact(9001) is None


def test_detect_topic_change_checkpoint() -> None:
    assert detect_topic_change_checkpoint("我们换个话题，写周报") == "topic_change"
    assert detect_topic_change_checkpoint("继续上面的方案") is None


def test_detect_user_requested_via_extra_meta() -> None:
    assert (
        detect_topic_change_checkpoint(
            "hello",
            {"checkpoint_compact": True},
        )
        == "user_requested"
    )


def test_resolve_prefers_pending_over_topic_heuristic() -> None:
    mark_pending_compact(9002, "delegation_completed")
    reason = resolve_checkpoint_compact_reason(9002, "换个话题")
    assert reason == "delegation_completed"
    assert consume_pending_compact(9002) is None

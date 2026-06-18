"""Tests for usage estimation fallback."""

import json

import src.service.usage_estimation as usage_estimation
from src.service.usage_estimation import (
    estimate_text_tokens,
    estimate_usage_for_conversation_turn,
)


class _FakeMessage:
    def __init__(
        self,
        *,
        id: int,
        role: str = "assistant",
        content: str | None = None,
        message_parts: str | None = None,
        extra_meta: str | None = None,
    ) -> None:
        self.id = id
        self.role = role
        self.content = content
        self.message_parts = message_parts
        self.extra_meta = extra_meta


class _FakeScalars:
    def __init__(self, items: list) -> None:
        self._items = items

    def all(self) -> list:
        return self._items


class _FakeDb:
    def __init__(self, messages: list) -> None:
        self._messages = messages

    def scalars(self, _stmt) -> _FakeScalars:
        return _FakeScalars(self._messages)


def test_estimate_text_tokens_non_empty() -> None:
    count = estimate_text_tokens("你好 world " * 20)
    assert count > 10


def test_fallback_ratio_ascii_not_double_counted(monkeypatch) -> None:
    """When tiktoken is unavailable, ASCII text must not be ~len/2 (2x too high).

    cl100k_base encodes English at roughly 4 chars/token; the old len//2
    fallback over-counted by ~2.4x, a primary "估算值离谱" driver.
    """

    def _no_tiktoken(name):  # noqa: ANN001
        raise ImportError("tiktoken unavailable")

    monkeypatch.setattr(usage_estimation, "_get_tiktoken_encoding", _no_tiktoken)

    text = "The quick brown fox jumps over the lazy dog. " * 40
    count = estimate_text_tokens(text)
    # Real cl100k count for this corpus is ~360; allow generous slack but
    # reject the old len//2 behavior (~900).
    assert count <= len(text) // 3


def test_historical_tool_output_does_not_inflate_input(monkeypatch) -> None:
    """A huge persisted tool output in history must not balloon the input estimate.

    The agent truncates old tool args / head-tail drops the middle before the
    LLM call, so counting every historical tool dump verbatim is the bug.
    """
    monkeypatch.setattr(
        usage_estimation, "_get_tiktoken_encoding", lambda name: None
    )

    huge_tool_dump = "X" * 400_000  # ~100k tokens of raw tool output
    history_with_dump = _FakeDb(
        [
            _FakeMessage(id=1, role="user", content="short question"),
            _FakeMessage(
                id=2,
                role="assistant",
                content="ok",
                message_parts=json.dumps(
                    [{"type": "tool-read_file", "content": huge_tool_dump}],
                    ensure_ascii=False,
                ),
            ),
        ]
    )
    history_without_dump = _FakeDb(
        [
            _FakeMessage(id=1, role="user", content="short question"),
            _FakeMessage(id=2, role="assistant", content="ok"),
        ]
    )

    with_dump = estimate_usage_for_conversation_turn(
        history_with_dump,  # type: ignore[arg-type]
        conversation_id=1,
        stream_msg_id=99,
        assistant_content="reply",
        message_parts_json=None,
        system_overhead_tokens=100,
    )
    without_dump = estimate_usage_for_conversation_turn(
        history_without_dump,  # type: ignore[arg-type]
        conversation_id=1,
        stream_msg_id=99,
        assistant_content="reply",
        message_parts_json=None,
        system_overhead_tokens=100,
    )
    assert with_dump is not None and without_dump is not None
    # The 100k-token historical tool dump must not dominate the estimate.
    assert with_dump["input_tokens"] < 20_000


def test_estimate_capped_at_max_input_tokens(monkeypatch) -> None:
    """The estimate must never exceed max_input_tokens (no >100% ring)."""
    monkeypatch.setattr(
        usage_estimation, "_get_tiktoken_encoding", lambda name: None
    )
    big = "word " * 200_000
    db = _FakeDb([_FakeMessage(id=1, role="user", content=big)])
    usage = estimate_usage_for_conversation_turn(
        db,  # type: ignore[arg-type]
        conversation_id=1,
        stream_msg_id=99,
        assistant_content="reply",
        message_parts_json=None,
        system_overhead_tokens=100,
        max_input_tokens=8000,
    )
    assert usage is not None
    assert usage["input_tokens"] <= 8000


def test_referenced_images_add_flat_token_cost() -> None:
    """Images referenced via extra_meta.files occupy context (~1500 tok each).

    They are sent to the model as image blocks at runtime but stored as file
    references, so the text-only estimate misses them entirely and undercounts
    vision turns. Mirror hermes-agent: count a flat per-image token cost.
    """
    files = json.dumps(
        {"files": [{"path": "/uploads/a.png"}, {"path": "/uploads/b.jpg"}]},
        ensure_ascii=False,
    )
    with_images = _FakeDb(
        [_FakeMessage(id=1, role="user", content="看这两张图", extra_meta=files)]
    )
    without_images = _FakeDb(
        [_FakeMessage(id=1, role="user", content="看这两张图")]
    )
    a = estimate_usage_for_conversation_turn(
        with_images,  # type: ignore[arg-type]
        conversation_id=1,
        stream_msg_id=99,
        assistant_content="好的",
        message_parts_json=None,
        system_overhead_tokens=100,
    )
    b = estimate_usage_for_conversation_turn(
        without_images,  # type: ignore[arg-type]
        conversation_id=1,
        stream_msg_id=99,
        assistant_content="好的",
        message_parts_json=None,
        system_overhead_tokens=100,
    )
    assert a is not None and b is not None
    # Two images ≈ 2 × IMAGE_TOKEN_COST added on top of the text estimate.
    assert a["input_tokens"] - b["input_tokens"] >= 2500


def test_non_image_files_add_no_image_cost() -> None:
    """A referenced .pdf is not an image and must not add image token cost."""
    files = json.dumps({"files": [{"path": "/uploads/report.pdf"}]}, ensure_ascii=False)
    with_pdf = _FakeDb(
        [_FakeMessage(id=1, role="user", content="看这个文件", extra_meta=files)]
    )
    without = _FakeDb([_FakeMessage(id=1, role="user", content="看这个文件")])
    a = estimate_usage_for_conversation_turn(
        with_pdf,  # type: ignore[arg-type]
        conversation_id=1, stream_msg_id=99, assistant_content="好的",
        message_parts_json=None, system_overhead_tokens=100,
    )
    b = estimate_usage_for_conversation_turn(
        without,  # type: ignore[arg-type]
        conversation_id=1, stream_msg_id=99, assistant_content="好的",
        message_parts_json=None, system_overhead_tokens=100,
    )
    assert a is not None and b is not None
    assert a["input_tokens"] == b["input_tokens"]


def test_estimate_usage_for_conversation_turn() -> None:
    parts = json.dumps(
        [
            {"type": "tool-read_file", "content": "README line " * 50},
            {"type": "text", "text": "done"},
        ],
        ensure_ascii=False,
    )
    db = _FakeDb(
        [
            _FakeMessage(id=1, content="用户问题 " * 30),
            _FakeMessage(id=2, content="上一轮回复 " * 20),
        ]
    )
    usage = estimate_usage_for_conversation_turn(
        db,  # type: ignore[arg-type]
        conversation_id=1,
        stream_msg_id=99,
        assistant_content="本轮 assistant 回复",
        message_parts_json=parts,
        system_overhead_tokens=100,
    )
    assert usage is not None
    assert usage["estimated"] is True
    assert usage["input_tokens"] > usage["output_tokens"]
    assert usage["output_tokens"] > 0

"""Tests for usage estimation fallback."""

import json

from src.service.usage_estimation import (
    estimate_text_tokens,
    estimate_usage_for_conversation_turn,
)


class _FakeMessage:
    def __init__(
        self,
        *,
        id: int,
        content: str | None = None,
        message_parts: str | None = None,
    ) -> None:
        self.id = id
        self.content = content
        self.message_parts = message_parts


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

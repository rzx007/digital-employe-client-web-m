"""Tests for conversation context budget API."""

import json

from src.service.context_budget import resolve_context_budget_for_conversation


class _FakeMessage:
    def __init__(self, *, id: int, role: str, extra_meta: str | None) -> None:
        self.id = id
        self.role = role
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


def test_resolve_context_budget_at_summarize_threshold(monkeypatch) -> None:
    from types import SimpleNamespace

    monkeypatch.setattr(
        "src.service.context_budget.get_settings",
        lambda: SimpleNamespace(
            model_max_input_tokens=100_000,
            summarization_trigger_fraction=0.75,
        ),
    )
    usage = json.dumps({"usage": {"input_tokens": 80_000, "output_tokens": 1200}})
    db = _FakeDb(
        [
            _FakeMessage(id=9, role="assistant", extra_meta=usage),
        ]
    )
    snap = resolve_context_budget_for_conversation(db, 42)  # type: ignore[arg-type]
    assert snap.last_input_tokens == 80_000
    assert snap.summarization_threshold == 75_000
    assert snap.zone == "at_summarize"
    assert snap.usage_percent_of_summarize == 106.7


def test_resolve_context_budget_estimated_usage(monkeypatch) -> None:
    from types import SimpleNamespace

    monkeypatch.setattr(
        "src.service.context_budget.get_settings",
        lambda: SimpleNamespace(
            model_max_input_tokens=100_000,
            summarization_trigger_fraction=0.75,
        ),
    )
    usage = json.dumps(
        {"usage": {"input_tokens": 12_000, "output_tokens": 400, "estimated": True}}
    )
    db = _FakeDb([_FakeMessage(id=3, role="assistant", extra_meta=usage)])
    snap = resolve_context_budget_for_conversation(db, 7)  # type: ignore[arg-type]
    assert snap.last_input_tokens == 12_000
    assert snap.source == "estimated"
    assert snap.zone == "ok"


def test_resolve_context_budget_unknown_without_usage(monkeypatch) -> None:
    from types import SimpleNamespace

    monkeypatch.setattr(
        "src.service.context_budget.get_settings",
        lambda: SimpleNamespace(
            model_max_input_tokens=100_000,
            summarization_trigger_fraction=0.75,
        ),
    )
    db = _FakeDb([_FakeMessage(id=1, role="assistant", extra_meta=None)])
    snap = resolve_context_budget_for_conversation(db, 1)  # type: ignore[arg-type]
    assert snap.zone == "unknown"
    assert snap.source == "none"

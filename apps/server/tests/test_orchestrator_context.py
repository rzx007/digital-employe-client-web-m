from __future__ import annotations

from unittest.mock import MagicMock

from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_db,
    reset_context,
    set_context,
)


def test_reset_context_scoped_to_conversation() -> None:
    db_a = MagicMock(name="db_a")
    db_b = MagicMock(name="db_b")
    set_context(db_a, 1, 101)
    set_context(db_b, 1, 202)

    assert get_conversation_id() == 202
    assert get_db() is db_b

    reset_context(101)
    assert get_conversation_id() == 202
    assert get_db() is db_b

    reset_context(202)
    try:
        get_db()
        raised = False
    except RuntimeError as exc:
        raised = True
        assert "orchestrator DB session not set" in str(exc)
    assert raised

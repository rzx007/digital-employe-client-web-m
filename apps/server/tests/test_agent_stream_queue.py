from __future__ import annotations

from src.service.agent_stream_queue import AgentStreamQueue, PendingStart


def _pending(
    conversation_id: int,
    *,
    priority: int = 10,
    source: str = "user_chat",
) -> PendingStart:
    return PendingStart(
        conversation_id=conversation_id,
        agent=object(),
        messages=[],
        config={"configurable": {"thread_id": conversation_id}},
        stream_msg_id=conversation_id * 10,
        skill_name="",
        debug_content_only=False,
        priority=priority,
        source=source,
    )


def test_queue_orders_by_priority_then_fifo() -> None:
    queue = AgentStreamQueue()

    queue.enqueue(_pending(1, priority=30, source="scheduled"))
    queue.enqueue(_pending(2, priority=10, source="user_chat"))
    queue.enqueue(_pending(3, priority=10, source="user_chat"))

    assert queue.depth() == 3
    assert queue.pop_next().conversation_id == 2
    assert queue.pop_next().conversation_id == 3
    assert queue.pop_next().conversation_id == 1
    assert queue.pop_next() is None


def test_queue_rejects_duplicate_conversation() -> None:
    queue = AgentStreamQueue()

    assert queue.enqueue(_pending(1)) is True
    assert queue.enqueue(_pending(1)) is False
    assert queue.depth() == 1


def test_queue_removes_pending_conversation() -> None:
    queue = AgentStreamQueue()
    queue.enqueue(_pending(1))
    queue.enqueue(_pending(2))

    removed = queue.remove(1)

    assert removed is not None
    assert removed.conversation_id == 1
    assert queue.depth() == 1
    assert queue.pop_next().conversation_id == 2

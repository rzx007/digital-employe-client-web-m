from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.core.agent_runtime_policy import AgentRuntimePolicy
from src.service.agent_stream_queue import PendingStart, StartResult
from src.service.stream_registry import ActiveStreamTask, StreamRegistry


def _mock_launch(self: StreamRegistry, pending: PendingStart) -> None:
    task = pending.task or ActiveStreamTask(pending.conversation_id)
    task.status = "streaming"
    mock_task = MagicMock()
    mock_task.done.return_value = False
    task._asyncio_task = mock_task
    self._tasks[pending.conversation_id] = task


@pytest.fixture
def serial_registry(monkeypatch: pytest.MonkeyPatch) -> StreamRegistry:
    monkeypatch.setattr(
        "src.service.stream_registry.get_agent_runtime_policy",
        lambda: AgentRuntimePolicy(serial_mode=True, max_concurrent_streams=1),
    )
    reg = StreamRegistry()
    monkeypatch.setattr(reg, "_launch_pending", _mock_launch.__get__(reg, StreamRegistry))
    return reg


def _fake_agent() -> MagicMock:
    return MagicMock()


def _pending(conv_id: int, stream_msg_id: int) -> PendingStart:
    return PendingStart(
        conversation_id=conv_id,
        agent=_fake_agent(),
        messages=[],
        config={"configurable": {"thread_id": conv_id}},
        stream_msg_id=stream_msg_id,
        skill_name="",
        debug_content_only=False,
        priority=10,
        source="user_chat",
        task=ActiveStreamTask(conv_id),
    )


def test_drain_re_enqueues_when_slot_busy(serial_registry: StreamRegistry) -> None:
    reg = serial_registry
    conv_a = 101
    conv_b = 102

    assert (
        reg.request_start(
            conv_a,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_a}},
            stream_msg_id=1001,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )

    assert (
        reg.request_start(
            conv_b,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_b}},
            stream_msg_id=1002,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.QUEUED
    )
    assert reg.queue_depth() == 1

    reg._drain_queue()
    assert reg.queue_depth() == 1

    task_a = reg.get_task(conv_a)
    assert task_a is not None
    task_a.status = "completed"
    reg._drain_queue()
    assert reg.queue_depth() == 0
    assert reg.get_task(conv_b) is not None
    assert reg.get_task(conv_b).status == "streaming"


def test_drain_clears_stale_active_and_launches(serial_registry: StreamRegistry) -> None:
    reg = serial_registry
    conv_a = 201
    conv_b = 202

    reg.request_start(
        conv_a,
        _fake_agent(),
        [],
        {"configurable": {"thread_id": conv_a}},
        stream_msg_id=2001,
        skill_name="",
        debug_content_only=False,
    )
    reg.request_start(
        conv_b,
        _fake_agent(),
        [],
        {"configurable": {"thread_id": conv_b}},
        stream_msg_id=2002,
        skill_name="",
        debug_content_only=False,
    )

    zombie = reg.get_task(conv_a)
    assert zombie is not None
    zombie._asyncio_task = None

    reg._drain_queue()
    assert reg.queue_depth() == 0
    assert reg.get_task(conv_b) is not None
    assert reg.get_task(conv_b).status == "streaming"


def test_new_request_queues_behind_pending_head(serial_registry: StreamRegistry) -> None:
    reg = serial_registry
    conv_a = 401
    conv_b = 402
    conv_d = 404

    reg.request_start(
        conv_a,
        _fake_agent(),
        [],
        {"configurable": {"thread_id": conv_a}},
        stream_msg_id=4001,
        skill_name="",
        debug_content_only=False,
    )
    assert (
        reg.request_start(
            conv_b,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_b}},
            stream_msg_id=4002,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.QUEUED
    )

    task_a = reg.get_task(conv_a)
    assert task_a is not None
    task_a.status = "completed"

    assert (
        reg.request_start(
            conv_d,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_d}},
            stream_msg_id=4004,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.QUEUED
    )
    assert reg.get_task(conv_b) is not None
    assert reg.get_task(conv_b).status == "streaming"
    assert reg.queue_depth() == 1


def test_two_slots_third_queued(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.service.stream_registry.get_agent_runtime_policy",
        lambda: AgentRuntimePolicy(serial_mode=True, max_concurrent_streams=2),
    )
    reg = StreamRegistry()
    monkeypatch.setattr(reg, "_launch_pending", _mock_launch.__get__(reg, StreamRegistry))

    conv_a, conv_b, conv_c = 501, 502, 503
    assert (
        reg.request_start(
            conv_a,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_a}},
            stream_msg_id=5001,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )
    assert (
        reg.request_start(
            conv_b,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_b}},
            stream_msg_id=5002,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )
    assert (
        reg.request_start(
            conv_c,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv_c}},
            stream_msg_id=5003,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.QUEUED
    )
    assert reg.queue_depth() == 1
    assert reg.get_task(conv_a).status == "streaming"
    assert reg.get_task(conv_b).status == "streaming"


def test_is_busy_includes_queued(serial_registry: StreamRegistry) -> None:
    reg = serial_registry
    conv = 301

    reg.request_start(
        conv,
        _fake_agent(),
        [],
        {"configurable": {"thread_id": conv}},
        stream_msg_id=3001,
        skill_name="",
        debug_content_only=False,
    )
    assert reg.is_busy(conv) is True

    reg.request_start(
        302,
        _fake_agent(),
        [],
        {"configurable": {"thread_id": 302}},
        stream_msg_id=3002,
        skill_name="",
        debug_content_only=False,
    )
    assert reg.is_busy(conv) is True
    assert reg.is_busy(302) is True

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


def test_request_start_clears_stale_active_then_admits(
    serial_registry: StreamRegistry,
) -> None:
    """会话残留僵尸活跃流（status=streaming 但 asyncio task 已死）时，新发送不应被
    REJECTED 卡死——request_start 须先回收僵尸再放行（与 _drain_queue 行为对齐）。

    复现「切换对话 / 重试时报『当前会话已有正在执行的任务』」：SSE 断开后后台 task
    变僵尸却仍占槽，此前 request_start 不查僵尸 → 永久拒绝，用户怎么发都报错。
    """
    reg = serial_registry
    conv = 601

    assert (
        reg.request_start(
            conv,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv}},
            stream_msg_id=6001,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )

    # 把这条流变成「僵尸」：仍 streaming，但其 asyncio task 已不存在（协程异常退出）。
    zombie = reg.get_task(conv)
    assert zombie is not None
    assert zombie.is_active
    zombie._asyncio_task = None

    # 同一会话再次发送：不应 REJECTED，应回收僵尸后重新 STARTED。
    assert (
        reg.request_start(
            conv,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv}},
            stream_msg_id=6002,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )
    fresh = reg.get_task(conv)
    assert fresh is not None
    assert fresh.stream_msg_id == 6002
    assert fresh.status == "streaming"


def test_user_chat_preempts_live_active_stream(
    serial_registry: StreamRegistry,
) -> None:
    """用户在同一会话主动重发（preempt=True）时，即便旧流仍真在跑（非僵尸），
    也应抢占：cancel 旧流后立刻起新流 → STARTED，而非 REJECTED。

    复现「重试报『当前会话已有正在执行的任务』、要等 3-5 分钟才好」：旧流卡死但
    未到 stall 超时墙，_stream_task_is_stale_active 仍 False；用户主动重发等于明确
    放弃上一轮，应当场抢占而非干等超时。
    """
    reg = serial_registry
    conv = 701

    assert (
        reg.request_start(
            conv,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv}},
            stream_msg_id=7001,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )

    # 旧流「真在跑」：asyncio task 存在且未完成（非僵尸，不到任何超时墙）。
    live = reg.get_task(conv)
    assert live is not None
    assert live.is_active
    assert live._asyncio_task is not None and not live._asyncio_task.done()
    old_asyncio_task = live._asyncio_task

    # 用户主动重发：preempt=True → 抢占。
    assert (
        reg.request_start(
            conv,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv}},
            stream_msg_id=7002,
            skill_name="",
            debug_content_only=False,
            preempt=True,
        )
        == StartResult.STARTED
    )
    # 旧 asyncio task 被取消。
    old_asyncio_task.cancel.assert_called()
    fresh = reg.get_task(conv)
    assert fresh is not None
    assert fresh.stream_msg_id == 7002
    assert fresh.status == "streaming"


def test_orchestration_does_not_preempt_live_stream(
    serial_registry: StreamRegistry,
) -> None:
    """编排派单（preempt 默认 False）撞上同会话在跑的活流时，仍按原语义拒绝，
    绝不抢占——抢占只属于「用户主动重发」这一条入口。"""
    reg = serial_registry
    conv = 702

    assert (
        reg.request_start(
            conv,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv}},
            stream_msg_id=7101,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.STARTED
    )

    # 不传 preempt（默认 False）→ 真活流不被抢占，照旧拒绝。
    assert (
        reg.request_start(
            conv,
            _fake_agent(),
            [],
            {"configurable": {"thread_id": conv}},
            stream_msg_id=7102,
            skill_name="",
            debug_content_only=False,
        )
        == StartResult.REJECTED
    )
    assert reg.get_task(conv).stream_msg_id == 7101


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

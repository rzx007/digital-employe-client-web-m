"""资源阀门 heavy/light 分级（切片 B）：

验证两道闸门——总闸 max_inflight 对所有任务生效；heavy 闸 max_heavy 仅约束重活，
给轻活留余量；并验证队头阻塞（HOL）被消除：队头重活被卡时后面的轻活可先上。
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.core.agent_runtime_policy import AgentRuntimePolicy
from src.service.agent_stream_queue import StartResult
from src.service.stream_registry import ActiveStreamTask, StreamRegistry


def _mock_launch(self: StreamRegistry, pending) -> None:
    task = pending.task or ActiveStreamTask(
        pending.conversation_id, stream_class=pending.stream_class
    )
    task.stream_class = pending.stream_class
    task.status = "streaming"
    mock_task = MagicMock()
    mock_task.done.return_value = False
    task._asyncio_task = mock_task
    self._tasks[pending.conversation_id] = task


def _make_registry(monkeypatch, *, max_inflight: int, max_heavy: int) -> StreamRegistry:
    monkeypatch.setattr(
        "src.service.stream_registry.get_agent_runtime_policy",
        lambda: AgentRuntimePolicy(
            serial_mode=False,
            max_concurrent_streams=0,
            max_inflight=max_inflight,
            max_heavy=max_heavy,
        ),
    )
    reg = StreamRegistry()
    monkeypatch.setattr(reg, "_launch_pending", _mock_launch.__get__(reg, StreamRegistry))
    return reg


def _fake_agent() -> MagicMock:
    return MagicMock()


def _start(reg: StreamRegistry, conv_id: int, stream_class: str) -> StartResult:
    return reg.request_start(
        conv_id,
        _fake_agent(),
        [],
        {"configurable": {"thread_id": conv_id}},
        stream_msg_id=conv_id * 10,
        skill_name="",
        debug_content_only=False,
        stream_class=stream_class,
    )


def test_heavy_capped_light_passes(monkeypatch) -> None:
    """max_inflight=3, max_heavy=1：重活只能 1 个，轻活仍可填到总上限 3。"""
    reg = _make_registry(monkeypatch, max_inflight=3, max_heavy=1)

    assert _start(reg, 1, "heavy") == StartResult.STARTED  # 重活 1/1
    assert _start(reg, 2, "heavy") == StartResult.QUEUED   # 重活超闸 → 排队
    assert _start(reg, 3, "light") == StartResult.STARTED  # 轻活用剩余总槽
    assert _start(reg, 4, "light") == StartResult.STARTED  # 总数到 3
    assert _start(reg, 5, "light") == StartResult.QUEUED   # 总闸满 → 排队

    assert reg.count_active_streams() == 3
    assert reg.count_active_heavy() == 1


def test_total_ceiling_applies_to_all(monkeypatch) -> None:
    """max_heavy=0（不单独限重活）时，行为退回纯总闸（切片 A）。"""
    reg = _make_registry(monkeypatch, max_inflight=2, max_heavy=0)
    assert _start(reg, 1, "heavy") == StartResult.STARTED
    assert _start(reg, 2, "heavy") == StartResult.STARTED  # 不受 heavy 闸约束
    assert _start(reg, 3, "heavy") == StartResult.QUEUED   # 仅受总闸约束


def test_drain_skips_blocked_heavy_for_light(monkeypatch) -> None:
    """队头阻塞消除：重活高优先在队头被 heavy 闸卡住时，后面的轻活先被放行。"""
    reg = _make_registry(monkeypatch, max_inflight=3, max_heavy=1)

    # 占满 heavy 闸：1 个重活在跑
    assert _start(reg, 1, "heavy") == StartResult.STARTED
    # 再来一个重活（高优先 priority=0）→ 排队（heavy 闸满）
    assert (
        reg.request_start(
            2, _fake_agent(), [], {"configurable": {"thread_id": 2}},
            stream_msg_id=20, skill_name="", debug_content_only=False,
            stream_class="heavy", priority=0,
        )
        == StartResult.QUEUED
    )
    # 一个轻活（低优先 priority=10）→ 也排队？不，总槽还有空(1/3)，会直接 STARTED
    # 为构造"队头是被卡重活、轻活在其后排队"，先把总槽占满到 3：
    assert _start(reg, 3, "light") == StartResult.STARTED  # 2/3
    assert _start(reg, 4, "light") == StartResult.STARTED  # 3/3，总闸满
    # 此刻队列里只有 conv2(heavy, pri0)。再加一个轻活 conv5 排在其后。
    assert (
        reg.request_start(
            5, _fake_agent(), [], {"configurable": {"thread_id": 5}},
            stream_msg_id=50, skill_name="", debug_content_only=False,
            stream_class="light", priority=10,
        )
        == StartResult.QUEUED
    )
    # 队列：[conv2(heavy,pri0), conv5(light,pri10)]，conv2 在队头。
    assert reg.queue_depth() == 2

    # 完成一个轻活 conv3 → 腾出 1 个总槽。此时 heavy 闸仍满(conv1 在跑)。
    # drain 应跳过队头被卡的重活 conv2，放行队尾的轻活 conv5。
    reg.get_task(3).status = "completed"
    reg._drain_queue()

    assert reg.get_task(5) is not None and reg.get_task(5).status == "streaming"
    # conv2（重活）仍在排队，因为 heavy 闸还满
    assert reg._queue.contains(2)
    assert reg.queue_depth() == 1

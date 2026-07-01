"""资源阀门：不分类总并发闸。

heavy/light 分级限流已移除（见 StreamRegistry.can_admit 注释：重活/轻活改为控制
单请求输出 token 上限，槽位准入只剩一道不分类的总闸 max_inflight）。这里验证：
总闸 max_inflight 对所有任务一视同仁生效；AGENT_MAX_HEAVY 已不再参与槽位准入。
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


def test_heavy_not_gated_only_total_ceiling(monkeypatch) -> None:
    """max_inflight=3, max_heavy=1：heavy 闸已废弃，重活同样能填满总上限 3。

    旧策略下此场景重活会被卡在 1 路；新策略只看不分类总闸，max_heavy=1 被忽略。
    """
    reg = _make_registry(monkeypatch, max_inflight=3, max_heavy=1)

    assert _start(reg, 1, "heavy") == StartResult.STARTED  # 1/3
    assert _start(reg, 2, "heavy") == StartResult.STARTED  # 2/3（不再受 heavy 闸约束）
    assert _start(reg, 3, "heavy") == StartResult.STARTED  # 3/3
    assert _start(reg, 4, "light") == StartResult.QUEUED   # 总闸满 → 排队

    assert reg.count_active_streams() == 3
    assert reg.count_active_heavy() == 3


def test_total_ceiling_applies_to_all(monkeypatch) -> None:
    """max_heavy=0（不单独限重活）时，行为退回纯总闸（切片 A）。"""
    reg = _make_registry(monkeypatch, max_inflight=2, max_heavy=0)
    assert _start(reg, 1, "heavy") == StartResult.STARTED
    assert _start(reg, 2, "heavy") == StartResult.STARTED  # 不受 heavy 闸约束
    assert _start(reg, 3, "heavy") == StartResult.QUEUED   # 仅受总闸约束


def test_light_borrows_idle_heavy_slots(monkeypatch) -> None:
    """heavy 未满时 light 可占空 heavy 槽（例如 1 heavy + 3 light）。"""
    reg = _make_registry(monkeypatch, max_inflight=4, max_heavy=3)

    assert _start(reg, 1, "heavy") == StartResult.STARTED
    assert _start(reg, 101, "light") == StartResult.STARTED
    assert _start(reg, 102, "light") == StartResult.STARTED
    assert _start(reg, 103, "light") == StartResult.STARTED
    assert _start(reg, 104, "light") == StartResult.QUEUED
    assert reg.count_active_streams() == 4
    assert reg.count_active_heavy() == 1

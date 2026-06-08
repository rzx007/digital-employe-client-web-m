import asyncio
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.core.agent_runtime_policy import (
    AGENT_MAX_HEAVY_DEFAULT,
    parse_agent_max_heavy,
)
from src.service.stream_registry import (
    ActiveStreamTask,
    StreamRegistry,
    _agent_stall_timeout,
    _agent_stream_timeouts,
    _graph_has_pending_non_interrupt_work,
)


# 「图有 pending 节点 → 续等」于 2026-06-08 恢复：chunk 超时(180s 无 chunk) 不再当场
# break——静默长工具(execute_timeout 允许跑到 600s)/模型长思考会 >180s 无事件，属健康
# 长流，图里仍有待执行节点时应继续等；真挂死交由独立的 900s 内容看门狗标 error 回收。
# 故重新引入 _graph_has_pending_non_interrupt_work 判定（不再保留 20 次续等上限/假装 completed）。


def test_graph_pending_true_when_next_without_interrupt() -> None:
    agent = SimpleNamespace(
        aget_state=lambda _config: asyncio.sleep(
            0,
            result=SimpleNamespace(
                next=("agent",),
                tasks=(SimpleNamespace(interrupts=None),),
            ),
        )
    )
    assert asyncio.run(_graph_has_pending_non_interrupt_work(agent, {})) is True


def test_graph_pending_false_when_no_next() -> None:
    agent = SimpleNamespace(
        aget_state=lambda _config: asyncio.sleep(
            0, result=SimpleNamespace(next=(), tasks=())
        )
    )
    assert asyncio.run(_graph_has_pending_non_interrupt_work(agent, {})) is False


def test_graph_pending_false_when_hitl_interrupt() -> None:
    agent = SimpleNamespace(
        aget_state=lambda _config: asyncio.sleep(
            0,
            result=SimpleNamespace(
                next=("tools",),
                tasks=(SimpleNamespace(interrupts=("approve",)),),
            ),
        )
    )
    assert asyncio.run(_graph_has_pending_non_interrupt_work(agent, {})) is False


def test_graph_pending_false_when_aget_state_raises() -> None:
    """checkpointer 读不出状态时保守判 False（按收尾，不无限续等）。"""
    def _boom(_config):
        raise RuntimeError("checkpointer down")

    agent = SimpleNamespace(aget_state=_boom)
    assert asyncio.run(_graph_has_pending_non_interrupt_work(agent, {})) is False


def test_agent_stream_timeouts_defaults() -> None:
    chunk, first, stale = _agent_stream_timeouts()
    assert chunk >= 60.0
    assert first >= 30.0
    assert stale >= chunk + first


def test_agent_stall_timeout_default_thirty_minutes() -> None:
    stall = _agent_stall_timeout()
    chunk, first, _ = _agent_stream_timeouts()
    assert stall >= 1800.0
    assert stall >= max(chunk, first) + 60.0


def test_max_heavy_default_matches_policy() -> None:
    # heavy/light 分级限流已移除（StreamRegistry.can_admit 只剩不分类总闸），
    # AGENT_MAX_HEAVY 不再参与槽位准入，仅作残留配置项保留；
    # 默认值随并发策略调整为 4。
    assert AGENT_MAX_HEAVY_DEFAULT == 4
    assert parse_agent_max_heavy({}) == 4


def test_stale_active_on_stall(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.service.stream_registry._agent_stall_timeout",
        lambda: 60.0,
    )
    task = ActiveStreamTask(1, stream_class="heavy")
    mock_async = MagicMock()
    mock_async.done.return_value = False
    task._asyncio_task = mock_async
    task._last_progress_at = time.monotonic() - 120.0
    assert StreamRegistry._stream_task_is_stale_active(task) is True


def test_stale_clear_reason_stall(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.service.stream_registry._agent_stall_timeout",
        lambda: 90.0,
    )
    task = ActiveStreamTask(2, stream_class="heavy")
    mock_async = MagicMock()
    mock_async.done.return_value = False
    task._asyncio_task = mock_async
    task._last_progress_at = time.monotonic() - 100.0
    reason = StreamRegistry._stale_clear_reason(task)
    assert "无进展" in reason
    assert "90" in reason

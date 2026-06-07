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
)


# 注：原 test_graph_pending_* 与 test_max_pending_retries_reasonable 已随
# 「图有 pending 节点 → 续等」机制于 2026-06-07 一并移除。判死改为「chunk 超时
# (默认 180s 无任何 chunk) 即收尾」——chunk 间隔本身就是充分判死信号，不再问图状态。


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


def test_max_heavy_default_is_unlimited() -> None:
    assert AGENT_MAX_HEAVY_DEFAULT == 0
    assert parse_agent_max_heavy({}) == 0


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

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.core.agent_runtime_policy import (
    AGENT_MAX_HEAVY_DEFAULT,
    parse_agent_max_heavy,
)
from src.service.stream_registry import (
    MAX_PENDING_CHUNK_TIMEOUT_RETRIES,
    ActiveStreamTask,
    StreamRegistry,
    _agent_stall_timeout,
    _agent_stream_timeouts,
    _graph_has_pending_non_interrupt_work,
)


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


def test_agent_stream_timeouts_defaults() -> None:
    chunk, first, stale = _agent_stream_timeouts()
    assert chunk >= 60.0
    assert first >= 30.0
    assert stale >= chunk + first


def test_max_pending_retries_reasonable() -> None:
    assert MAX_PENDING_CHUNK_TIMEOUT_RETRIES >= 5


def test_agent_stall_timeout_default_thirty_minutes() -> None:
    stall = _agent_stall_timeout()
    chunk, first, _ = _agent_stream_timeouts()
    assert stall >= 1800.0
    assert stall >= max(chunk, first) + 60.0


def test_max_heavy_default_is_one() -> None:
    assert AGENT_MAX_HEAVY_DEFAULT == 1
    assert parse_agent_max_heavy({}) == 1


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

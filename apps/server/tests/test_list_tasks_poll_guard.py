"""list_tasks 反复轮询硬闸：终结「组长确认计划后反复查状态」死循环。"""

from src.service.agent.orchestrator import task_listing
from src.service.agent.orchestrator.task_listing import (
    _POLL_HARD_LIMIT,
    _record_poll_and_should_block,
    reset_poll_guard,
)


def setup_function() -> None:
    # 每个用例前清空全局计数，避免相互污染。
    task_listing._recent_list_task_calls.clear()


def test_under_limit_does_not_block() -> None:
    conv = 9001
    for _ in range(_POLL_HARD_LIMIT - 1):
        assert _record_poll_and_should_block(conv) is False


def test_reaching_limit_blocks() -> None:
    conv = 9002
    results = [_record_poll_and_should_block(conv) for _ in range(_POLL_HARD_LIMIT)]
    # 前 N-1 次放行，第 N 次触发硬闸。
    assert results[:-1] == [False] * (_POLL_HARD_LIMIT - 1)
    assert results[-1] is True


def test_reset_clears_counter() -> None:
    conv = 9003
    for _ in range(_POLL_HARD_LIMIT):
        _record_poll_and_should_block(conv)
    reset_poll_guard(conv)
    # 重置后重新计数，第一次必放行。
    assert _record_poll_and_should_block(conv) is False


def test_per_conversation_isolation() -> None:
    # 不同会话各自独立计数，互不影响。
    for _ in range(_POLL_HARD_LIMIT):
        _record_poll_and_should_block(111)
    assert _record_poll_and_should_block(222) is False


def test_none_conversation_never_blocks() -> None:
    for _ in range(_POLL_HARD_LIMIT * 3):
        assert _record_poll_and_should_block(None) is False


def test_window_eviction_resets(monkeypatch) -> None:
    """窗口外的旧记录被丢弃 → 偶尔查一次永不触发硬闸。"""
    conv = 9004
    fake_now = {"t": 1000.0}
    monkeypatch.setattr(
        task_listing.time, "monotonic", lambda: fake_now["t"]
    )
    # 第一次查询
    assert _record_poll_and_should_block(conv) is False
    # 跨过整个窗口后再查 → 旧记录失效，仍从头计数
    fake_now["t"] += task_listing._POLL_WINDOW_SECONDS + 1
    assert _record_poll_and_should_block(conv) is False

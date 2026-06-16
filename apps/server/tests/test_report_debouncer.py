"""单测：ReportDebouncer（去抖器）。

不使用 pytest-asyncio；通过 asyncio.new_event_loop() + loop.run_until_complete()
驱动同一事件循环，令 call_later 计时器自然触发。
"""

from __future__ import annotations

import asyncio

from src.service.agent.orchestrator.report_debouncer import ReportDebouncer

# --------------------------------------------------------------------------
# 辅助工厂
# --------------------------------------------------------------------------

WINDOW_MS = 80   # 去抖窗口（ms），小值让测试快速完成
WAIT_FACTOR = 3  # 等待 WINDOW_MS * WAIT_FACTOR ms 确保窗口已过


def _make_debouncer(loop, *, is_busy_fn, fire_fn) -> ReportDebouncer:
    return ReportDebouncer(
        loop=loop,
        debounce_ms=WINDOW_MS,
        fire=fire_fn,
        is_busy=is_busy_fn,
    )


def _sleep(loop: asyncio.AbstractEventLoop, seconds: float) -> None:
    """在给定 loop 上同步等待指定秒数（让计时器有机会触发）。"""
    loop.run_until_complete(asyncio.sleep(seconds))


# --------------------------------------------------------------------------
# Test 1：去抖合并 —— 连续 notify 多次，fire 只被调用一次
# --------------------------------------------------------------------------

def test_debounce_merges_multiple_notifies() -> None:
    """短窗口内连续 notify(7) 三次 → fire 仅被调一次。"""
    loop = asyncio.new_event_loop()
    try:
        fire_count = 0
        fire_results: list[bool] = []

        async def fire(orch_conv_id: int) -> bool:
            nonlocal fire_count
            fire_count += 1
            fire_results.append(True)
            return True

        debouncer = _make_debouncer(
            loop,
            is_busy_fn=lambda _: False,
            fire_fn=fire,
        )

        # 连续三次 notify，间隔远小于窗口
        debouncer.notify(7)
        debouncer.notify(7)
        debouncer.notify(7)

        # 等足够长让计时器触发（窗口 * WAIT_FACTOR）
        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert fire_count == 1, f"期望 fire 被调 1 次，实际 {fire_count} 次"
        assert 7 not in debouncer._pending, "fire 成功后应清除 pending"
    finally:
        loop.close()


# --------------------------------------------------------------------------
# Test 2：占线 → on_stream_end 补触发
# --------------------------------------------------------------------------

def test_busy_then_stream_end_retriggers() -> None:
    """总管占线时 notify 不触发 fire；on_stream_end 后补触发。"""
    loop = asyncio.new_event_loop()
    try:
        fire_count = 0
        busy = True   # 初始占线

        async def fire(orch_conv_id: int) -> bool:
            nonlocal fire_count
            fire_count += 1
            return True

        debouncer = _make_debouncer(
            loop,
            is_busy_fn=lambda _: busy,
            fire_fn=fire,
        )

        # notify + 等窗口过期 → 因为 is_busy=True，fire 不应被调
        debouncer.notify(7)
        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert fire_count == 0, "占线时 fire 不应被调"
        assert 7 in debouncer._pending, "占线时 pending 应保留"

        # 流结束：切换占线状态，调 on_stream_end
        busy = False
        debouncer.on_stream_end(7)

        # 再等一个窗口
        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert fire_count == 1, f"on_stream_end 后 fire 应被调 1 次，实际 {fire_count}"
        assert 7 not in debouncer._pending, "fire 成功后应清除 pending"
    finally:
        loop.close()


# --------------------------------------------------------------------------
# Test 3a：消费成功清 pending
# --------------------------------------------------------------------------

def test_fire_true_clears_pending() -> None:
    """fire 返回 True → pending 中不再包含该 id。"""
    loop = asyncio.new_event_loop()
    try:
        async def fire_ok(orch_conv_id: int) -> bool:
            return True

        debouncer = _make_debouncer(
            loop,
            is_busy_fn=lambda _: False,
            fire_fn=fire_ok,
        )

        debouncer.notify(42)
        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert 42 not in debouncer._pending
    finally:
        loop.close()


# --------------------------------------------------------------------------
# Test 3b：消费失败保留 pending
# --------------------------------------------------------------------------

def test_fire_false_keeps_pending() -> None:
    """fire 返回 False（占线被拒）→ pending 仍保留。"""
    loop = asyncio.new_event_loop()
    try:
        fire_count = 0

        async def fire_reject(orch_conv_id: int) -> bool:
            nonlocal fire_count
            fire_count += 1
            return False  # 模拟被拒（如 REJECTED）

        debouncer = _make_debouncer(
            loop,
            is_busy_fn=lambda _: False,
            fire_fn=fire_reject,
        )

        debouncer.notify(99)
        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert fire_count == 1, "fire 应被调一次"
        assert 99 in debouncer._pending, "fire 返回 False 时 pending 应保留"
    finally:
        loop.close()


# --------------------------------------------------------------------------
# Test 4：多 id 互不干扰
# --------------------------------------------------------------------------

def test_multiple_ids_independent() -> None:
    """不同 orch_conv_id 的计时器互不干扰。"""
    loop = asyncio.new_event_loop()
    try:
        fired: list[int] = []

        async def fire(orch_conv_id: int) -> bool:
            fired.append(orch_conv_id)
            return True

        debouncer = _make_debouncer(
            loop,
            is_busy_fn=lambda _: False,
            fire_fn=fire,
        )

        debouncer.notify(1)
        debouncer.notify(2)
        debouncer.notify(1)  # 重置 id=1 的计时器

        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert sorted(fired) == [1, 2], f"期望 fire 被调两个 id，实际 {fired}"
        assert 1 not in debouncer._pending
        assert 2 not in debouncer._pending
    finally:
        loop.close()


# --------------------------------------------------------------------------
# Test 5：on_stream_end 对无 pending 的 id 无副作用
# --------------------------------------------------------------------------

def test_on_stream_end_no_pending_noop() -> None:
    """对无 pending 的 id 调 on_stream_end 不应有任何副作用。"""
    loop = asyncio.new_event_loop()
    try:
        fire_count = 0

        async def fire(orch_conv_id: int) -> bool:
            nonlocal fire_count
            fire_count += 1
            return True

        debouncer = _make_debouncer(
            loop,
            is_busy_fn=lambda _: False,
            fire_fn=fire,
        )

        # id=55 从未 notify 过
        debouncer.on_stream_end(55)
        _sleep(loop, WINDOW_MS * WAIT_FACTOR / 1000)

        assert fire_count == 0
    finally:
        loop.close()

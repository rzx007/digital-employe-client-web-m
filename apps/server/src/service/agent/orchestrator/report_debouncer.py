"""增量汇报去抖器。

每个 orchestrator_conversation_id 独立计时，合并近乎同时到达的任务完成通知，
避免总管被频繁/并发唤醒（总管正在流式时 request_start 会被 REJECTED）。

接口设计为纯逻辑 + 可注入回调，方便单测不依赖真实 stream。
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class ReportDebouncer:
    """Per-conversation 去抖器。

    Args:
        loop: 主事件循环（装配时捕获；notify 经 call_soon_threadsafe 跨线程投递后
              在此 loop 内调度，因此 _flush 也运行在此 loop）。
        debounce_ms: 去抖窗口，毫秒。
        fire: async fn(orch_conv_id: int) -> bool
              起一轮汇报 turn；返回 True 表示成功消费（任务已被处理），
              返回 False 表示消费失败（如总管仍占线被拒）。
        is_busy: fn(orch_conv_id: int) -> bool
                 查询总管会话是否正在流式输出中。
    """

    def __init__(
        self,
        *,
        loop: asyncio.AbstractEventLoop,
        debounce_ms: int = 1500,
        fire,   # async fn(orch_conv_id: int) -> bool
        is_busy,  # fn(orch_conv_id: int) -> bool
    ) -> None:
        self._loop = loop
        self._debounce = debounce_ms / 1000
        self._fire = fire
        self._is_busy = is_busy
        self._timers: dict[int, asyncio.TimerHandle] = {}
        self._pending: set[int] = set()   # 有待汇报的会话

    # ------------------------------------------------------------------
    # 公开接口
    # ------------------------------------------------------------------

    def notify(self, orch_conv_id: int) -> None:
        """任务完成时调用（已在主事件循环线程内：经 call_soon_threadsafe 投递）。

        (重)启去抖计时。短时间内的多次 notify 只会触发一次 _flush。
        """
        self._pending.add(orch_conv_id)
        if (t := self._timers.pop(orch_conv_id, None)):
            t.cancel()
        self._timers[orch_conv_id] = self._loop.call_later(
            self._debounce,
            lambda: self._loop.create_task(self._flush(orch_conv_id)),
        )

    def on_stream_end(self, orch_conv_id: int) -> None:
        """总管流结束钩子：若该会话仍有待汇报则补触发一次去抖。"""
        if orch_conv_id in self._pending:
            self.notify(orch_conv_id)

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------

    async def _flush(self, orch_conv_id: int) -> None:
        """去抖窗口到期后执行：若总管不占线则 fire，否则留待 on_stream_end 补触发。"""
        self._timers.pop(orch_conv_id, None)
        if self._is_busy(orch_conv_id):
            # 总管占线：保留在 _pending，等 on_stream_end 重新 notify
            logger.debug(
                "ReportDebouncer: orch_conv_id=%d 总管占线，延迟到流结束再汇报",
                orch_conv_id,
            )
            return
        ok = await self._fire(orch_conv_id)
        if ok:
            self._pending.discard(orch_conv_id)
            logger.debug(
                "ReportDebouncer: orch_conv_id=%d 汇报成功，清除 pending",
                orch_conv_id,
            )
        else:
            logger.debug(
                "ReportDebouncer: orch_conv_id=%d fire 返回 False，保留 pending",
                orch_conv_id,
            )

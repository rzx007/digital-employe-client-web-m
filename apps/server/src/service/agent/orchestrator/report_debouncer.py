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


# ---------------------------------------------------------------------------
# 装配点：进程级单例（懒初始化）
# ---------------------------------------------------------------------------

_REPORT_DEBOUNCER: ReportDebouncer | None = None


async def _fire_incremental_report(orch_conv_id: int) -> bool:
    """ReportDebouncer.fire 的 async 包装：开独立 DB session、解析 workspace_id、
    同步调用 trigger_incremental_report，返回其 bool。

    本协程跑在主事件循环内（_flush -> await self._fire），故 trigger_incremental_report
    内部的同步 request_start（需 running loop）满足前置条件。
    """
    from src.models.conversation import Conversation
    from src.service.agent.orchestrator.reentry import (
        _new_session,
        trigger_incremental_report,
    )

    db = _new_session()
    try:
        conv = db.get(Conversation, orch_conv_id)
        if conv is None:
            # 会话已不存在：无从解析 workspace_id，视为已消费（无可重试）。
            logger.warning(
                "report_debouncer fire: conv=%s 不存在，跳过", orch_conv_id
            )
            return True
        return trigger_incremental_report(db, orch_conv_id, conv.workspace_id)
    finally:
        db.close()


def get_report_debouncer() -> ReportDebouncer:
    """进程级 ReportDebouncer 单例（懒初始化）。

    - loop：主事件循环（沿用 runtime.get_main_loop()，与 reentry 的跨线程投递一致）。
    - fire：_fire_incremental_report（async 包装，见上）。
    - is_busy：registry.is_busy（会话占用流槽：active 或 queued）。
    """
    global _REPORT_DEBOUNCER
    if _REPORT_DEBOUNCER is None:
        from src.service.agent.orchestrator.runtime import get_main_loop
        from src.service.stream_registry import registry

        _REPORT_DEBOUNCER = ReportDebouncer(
            loop=get_main_loop(),
            fire=_fire_incremental_report,
            is_busy=lambda conv_id: registry.is_busy(conv_id),
        )
    return _REPORT_DEBOUNCER


# ---------------------------------------------------------------------------
# 重启对账：补触发进程重启前遗漏的汇报
# ---------------------------------------------------------------------------

def reconcile_unreported_tasks(db) -> list[int]:
    """扫描终态但 reported_at IS NULL 的 TaskExecutionLog，返回需补汇报的
    orchestrator_conversation_id 去重列表（纯查询，调用方负责对每个 conv 调 notify）。

    设计：
    - 只选 run_status in _SETTLED_STATES（成功/失败/跳过等终态）且 reported_at IS NULL。
    - 只选 orchestrator_conversation_id 非空的（非总管关联的任务无需汇报）。
    - 去重后返回 conv id 列表，供调用方（server.py lifespan）做 notify；
      函数本身不调 notify，保持可单测性（测试只验证"选对了哪些会话"）。

    Returns:
        需补汇报的 orchestrator_conversation_id 列表（已去重，顺序不定）。
    """
    from sqlalchemy import select
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.orchestrator.dependency_scheduler import _SETTLED_STATES

    rows = db.scalars(
        select(TaskExecutionLog.orchestrator_conversation_id).where(
            TaskExecutionLog.run_status.in_(_SETTLED_STATES),
            TaskExecutionLog.reported_at.is_(None),
            TaskExecutionLog.orchestrator_conversation_id.is_not(None),
        )
    ).all()

    conv_ids = list({int(r) for r in rows if r is not None})
    return conv_ids

"""ChannelManager：channel-无关的回执分发器。

订阅事件总线，按 ChannelInbox 行把总管那一轮的终态回执到对应 channel。
两种收尾：
- 纯对话回复：conversation_status_changed(idle/error) 且该会话无 PlanRun → 立刻回执。
- 编排轮：⚠️总管自己的流先结束发 idle，此刻 PlanRun 尚未 settle。收到 idle 时若该
  会话已有 run → 回填 plan_run_id、保持 running、先不回执，等 plan_run_settled 再回执。
"""

from __future__ import annotations

import json
import logging
import threading

from src.service.channel.report import build_channel_report
from src.service.orchestration_lifecycle import (
    resolve_latest_run_id_by_conversation,
)
from src.service.channel import inbox_service
from src.service.stream_registry import registry
from src.service.workspace_events import WorkspaceEventBus

logger = logging.getLogger(__name__)


class ChannelManager:
    def __init__(self) -> None:
        self._channels: dict[str, "object"] = {}
        self._running = False
        self._thread: threading.Thread | None = None
        self._queue = None

    def register(self, channel) -> None:
        self._channels[channel.name] = channel

    def get(self, name: str):
        return self._channels.get(name)

    def _on_terminal_event(self, db, evt: dict) -> None:
        """事件总线投来的一条事件 → 按类型分流回执。字段全用 .get 容错。"""
        etype = evt.get("type")
        if etype == "conversation_status_changed":
            if evt.get("status") not in ("idle", "error"):
                return
            conversation_id = evt.get("conversation_id")
            if conversation_id is None:
                return
            row = inbox_service.find_pending_by_conversation(db, conversation_id)
            if row is None:
                return
            # 只算这条指令进来之后才开始的 run（排除共享会话里的历史 PlanRun，
            # 否则纯对话回复会被老 run 误判成编排轮、傻等永不来的 plan_run_settled）。
            run_id = resolve_latest_run_id_by_conversation(
                db, row.conversation_id, since=row.created_at
            )
            if run_id is None:
                # 纯对话回复：立刻回执。
                self._report(db, row)
            else:
                # 编排轮：回填 run，保持 running，等 plan_run_settled 再回执。
                inbox_service.mark(db, row, "running", plan_run_id=run_id)
        elif etype == "plan_run_settled":
            run_id = evt.get("run_id")
            if run_id is None:
                return
            row = inbox_service.find_pending_by_plan_run(db, run_id)
            if row is None:
                return
            self._report(db, row)
        # 不认识的事件类型：直接忽略。

    def _report(self, db, row) -> None:
        """构建报告 → 经对应 channel 发出 → 标 reported。

        幂等天然成立：mark reported 后该行不再是 pending，find_pending_* 不会再命中。
        """
        report = build_channel_report(db, row)
        ch = self.get(row.channel)
        if ch is not None:
            ch.send_report(row.external_chat_id, report)
        inbox_service.mark(db, row, "reported", reported=True)

    # --- 生命周期 -----------------------------------------------------------

    def start(self) -> None:
        """启动各 channel、做重启对账、起后台订阅线程。"""
        for ch in list(self._channels.values()):
            try:
                ch.start()
            except Exception:
                logger.warning("channel %s start failed", getattr(ch, "name", "?"), exc_info=True)

        from src.db.session import get_session_local

        db = get_session_local()()
        try:
            self.reconcile_on_start(db)
        except Exception:
            logger.warning("channel reconcile_on_start failed", exc_info=True)
        finally:
            db.close()

        self._running = True
        self._queue = WorkspaceEventBus.subscribe_all()
        self._thread = threading.Thread(
            target=self._run_loop, name="channel-manager", daemon=True
        )
        self._thread.start()

    def _run_loop(self) -> None:
        from src.db.session import get_session_local

        while self._running:
            try:
                data = self._queue.get(timeout=1.0)
            except Exception:
                continue  # 超时/空 → 回头看 _running 是否仍为 True
            if data is None:  # 停机哨兵
                break
            try:
                evt = json.loads(data)
            except Exception:
                continue
            db = get_session_local()()
            try:
                self._on_terminal_event(db, evt)
            except Exception:
                logger.warning("channel manager dispatch failed", exc_info=True)
            finally:
                db.close()

    def stop(self) -> None:
        self._running = False
        if self._queue is not None:
            try:
                self._queue.put_nowait(None)  # 哨兵唤醒线程立即退出
            except Exception:
                pass
        for ch in list(self._channels.values()):
            try:
                ch.stop()
            except Exception:
                logger.warning("channel %s stop failed", getattr(ch, "name", "?"), exc_info=True)
        # 退订全局队列，避免反复 start/stop 泄漏废弃 queue
        try:
            if getattr(self, "_queue", None) is not None:
                WorkspaceEventBus.unsubscribe_all(self._queue)
        except Exception:
            pass
        # join 后台线程
        t = getattr(self, "_thread", None)
        if t is not None:
            t.join(timeout=2.0)

    def reconcile_on_start(self, db) -> None:
        """重启对账：未结清的入站行，若其会话流已不再 active（进程崩过）→ 回执中断、标 failed。"""
        for row in inbox_service.list_unsettled(db):
            if registry.is_active(row.conversation_id):
                continue  # 还在跑，留给正常事件路径
            ch = self.get(row.channel)
            if ch is not None:
                try:
                    ch.send_report(row.external_chat_id, "执行被中断，请重试")
                except Exception:
                    logger.warning("reconcile send_report failed row=%s", row.id, exc_info=True)
            inbox_service.mark(db, row, "failed")


manager = ChannelManager()

"""ChannelManager：channel-无关的回执分发器。

订阅事件总线，按 ChannelInbox 行把总管那一轮的终态回执到对应 channel。
两种收尾：
- 纯对话回复：conversation_status_changed(idle/error) 且该会话无 PlanRun → 立刻回执。
- 编排轮：⚠️总管自己的流先结束发 idle，此刻 PlanRun 尚未 settle。收到 idle 时若该
  会话已有 run → 回填 plan_run_id、保持 running、先不回执，等 plan_run_settled 再回执。
"""

from __future__ import annotations

import logging

from src.service.channel.report import build_channel_report
from src.service.orchestration_lifecycle import (
    resolve_latest_run_id_by_conversation,
)
from src.service.channel import inbox_service

logger = logging.getLogger(__name__)


class ChannelManager:
    def __init__(self) -> None:
        self._channels: dict[str, "object"] = {}

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
            run_id = resolve_latest_run_id_by_conversation(db, row.conversation_id)
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


manager = ChannelManager()

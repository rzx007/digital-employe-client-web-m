import logging

from src.service.channel.base import Channel, InboundMessage

logger = logging.getLogger(__name__)


def parse_lark_message_event(data) -> InboundMessage | None:
    """从 P2ImMessageReceiveV1 提取 InboundMessage；非文本/缺字段返回 None。"""
    import json

    try:
        header = getattr(data, "header", None)
        event = getattr(data, "event", None)
        if event is None:
            return None
        message = getattr(event, "message", None)
        sender = getattr(event, "sender", None)
        if message is None or sender is None:
            return None
        if getattr(message, "message_type", None) != "text":
            return None
        sender_id = getattr(sender, "sender_id", None)
        open_id = getattr(sender_id, "open_id", None) if sender_id else None
        chat_id = getattr(message, "chat_id", None)
        event_id = getattr(header, "event_id", None) if header else None
        content = getattr(message, "content", None)
        if not (open_id and chat_id and event_id and content):
            return None
        text = json.loads(content).get("text", "")
        if not text:
            return None
        return InboundMessage(
            external_user_id=open_id, external_chat_id=chat_id,
            text=text, external_event_id=event_id,
        )
    except Exception:
        return None


class FeishuChannel(Channel):
    name = "feishu"

    def __init__(self, app_id, app_secret, whitelist):
        from src.service.channel.feishu_im import FeishuIMService

        self._whitelist = set(whitelist or [])
        self._im = FeishuIMService(app_id, app_secret)
        self._app_id = app_id
        self._app_secret = app_secret
        self._ws = None
        self._thread = None
        self._stopped = False

    def is_authorized(self, uid):
        return uid in self._whitelist

    def send_ack(self, chat_id, text):
        self._im.send_text(chat_id, text)

    def send_report(self, chat_id, report):
        self._im.send_text(chat_id, report)

    def handle_inbound(self, db, msg: InboundMessage) -> None:
        from src.service.channel import inbox_service
        from src.service.channel.resolve import resolve_active_curator_conversation
        from src.service.agent.orchestrator.curator_injection import (
            inject_curator_instruction,
        )
        from src.service.stream_registry import registry

        if not self.is_authorized(msg.external_user_id):
            self.send_ack(msg.external_chat_id, "未授权")
            return

        conv = resolve_active_curator_conversation(db)

        # 会话级忙碌兜底（本方法在主 loop 内被调，is_active 检查权威）
        if registry.is_active(conv.id):
            inbox_service.record_event(
                db, channel="feishu", external_event_id=msg.external_event_id,
                external_user_id=msg.external_user_id, external_chat_id=msg.external_chat_id,
                workspace_id=conv.workspace_id, conversation_id=conv.id,
                text=msg.text, status="rejected")
            self.send_ack(msg.external_chat_id, "⏳ 总管正忙，待会再试")
            return

        row = inbox_service.record_event(
            db, channel="feishu", external_event_id=msg.external_event_id,
            external_user_id=msg.external_user_id, external_chat_id=msg.external_chat_id,
            workspace_id=conv.workspace_id, conversation_id=conv.id,
            text=msg.text, status="acked")
        if row is None:
            return  # 重复 event_id，去重

        try:
            user_mid, asst_mid = inject_curator_instruction(db, conv, msg.text, source="feishu")
        except Exception:
            inbox_service.mark(db, row, "failed")
            self.send_ack(msg.external_chat_id, "❌ 启动失败，请稍后重试")
            raise

        inbox_service.mark(db, row, "running", user_message_id=user_mid, assistant_message_id=asst_mid)
        self.send_ack(msg.external_chat_id, "✅ 收到，已开始执行")

    def start(self):
        import threading

        self._stopped = False
        self._thread = threading.Thread(
            target=self._run_ws, name="feishu-ws", daemon=True
        )
        self._thread.start()
        logger.info("飞书 ws 长连接线程已启动")

    def _run_ws(self) -> None:
        """后台线程：用本线程独立 event loop 跑 lark ws.Client（阻塞）。

        lark 的 ws.Client.start() 用的是 **模块级全局 loop**（``lark_oapi.ws.client.loop``，
        在模块首次 import 时 ``asyncio.get_event_loop()`` 捕获）。本应用在 FastAPI 主 loop
        运行期间 import 它，会捕获到主 loop，导致后台线程里 ``loop.run_until_complete()``
        撞 "This event loop is already running"。这里给本线程建独立 loop 并覆盖该模块全局，
        我们是该 ws client 的唯一消费者，安全。
        """
        import asyncio

        import lark_oapi.ws.client as _lark_ws_client
        from lark_oapi import EventDispatcherHandler
        from lark_oapi.ws import Client as LarkWsClient

        try:
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            _lark_ws_client.loop = new_loop

            handler = (
                EventDispatcherHandler.builder("", "")
                .register_p2_im_message_receive_v1(self._on_lark_event)
                .build()
            )
            self._ws = LarkWsClient(
                self._app_id, self._app_secret, event_handler=handler
            )
            self._ws.start()  # 阻塞：跑 ws 收发循环
        except Exception:
            logger.error("飞书 ws 线程异常退出", exc_info=True)

    def stop(self):
        # lark ws.Client 无公开 stop()；置标志，daemon 线程随进程退出
        self._stopped = True
        logger.info("飞书 ws 长连接停止（daemon 线程随进程退出）")

    def _on_lark_event(self, data) -> None:
        """lark ws 回调线程：解析事件 → 投主 loop 用新 session 调 handle_inbound。"""
        try:
            if self._stopped:
                return  # stop() 后忽略残余事件，使 stop 标志真正生效
            msg = parse_lark_message_event(data)
            if msg is None:
                return
            from src.db.session import get_session_local
            from src.service.agent.orchestrator import _get_main_loop

            def _on_main():
                db = get_session_local()()
                try:
                    self.handle_inbound(db, msg)
                except Exception:
                    logger.error(
                        "飞书 handle_inbound 失败 event_id=%s",
                        msg.external_event_id, exc_info=True,
                    )
                finally:
                    db.close()

            _get_main_loop().call_soon_threadsafe(_on_main)
        except Exception:
            logger.exception("飞书 _on_lark_event 异常")

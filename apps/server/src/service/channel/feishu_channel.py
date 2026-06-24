from src.service.channel.base import Channel, InboundMessage


class FeishuChannel(Channel):
    name = "feishu"

    def __init__(self, app_id, app_secret, whitelist):
        from src.service.channel.feishu_im import FeishuIMService

        self._whitelist = set(whitelist or [])
        self._im = FeishuIMService(app_id, app_secret)
        self._app_id = app_id
        self._app_secret = app_secret
        self._ws = None

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
        # 骨架：起 lark-oapi WebSocket 长连接 client，事件回调把消息→InboundMessage→投主 loop→handle_inbound
        # ⚠️ 待 spike 在真实凭证下校验 lark-oapi ws.Client 的事件 handler 形态后填实；当前留接口
        ...

    def stop(self):
        # 骨架：停 ws 长连接。⚠️ 待 spike 校验 lark-oapi ws client 的 close/disconnect API 后填实。
        ...

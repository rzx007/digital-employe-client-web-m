from unittest.mock import MagicMock, patch
import pytest
from src.models.conversation import Conversation
from src.models.channel_inbox import ChannelInbox
from src.service.channel.base import InboundMessage


def _make_channel():
    # 不真构造 FeishuIMService（避免 import lark），patch 掉
    with patch("src.service.channel.feishu_channel.FeishuChannel.__init__", return_value=None):
        from src.service.channel.feishu_channel import FeishuChannel
        ch = FeishuChannel.__new__(FeishuChannel)
    ch._whitelist = {"ou_ok"}
    ch.send_ack = MagicMock()
    ch.send_report = MagicMock()
    return ch


def _conv(db):
    c = Conversation(workspace_id=1, user_id="1", target_type="curator", target_id=0, status="idle")
    db.add(c); db.commit(); return c


def test_unauthorized(db_session):
    ch = _make_channel()
    msg = InboundMessage(external_user_id="ou_bad", external_chat_id="oc", text="hi", external_event_id="e1")
    ch.handle_inbound(db_session, msg)
    ch.send_ack.assert_called_once()
    assert "未授权" in ch.send_ack.call_args[0][1]
    assert db_session.query(ChannelInbox).count() == 0


def test_busy_rejects(db_session, monkeypatch):
    ch = _make_channel(); conv = _conv(db_session)
    monkeypatch.setattr("src.service.channel.resolve.resolve_active_curator_conversation", lambda db: conv)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "is_active", lambda cid: True)
    msg = InboundMessage(external_user_id="ou_ok", external_chat_id="oc", text="hi", external_event_id="e2")
    ch.handle_inbound(db_session, msg)
    row = db_session.query(ChannelInbox).filter_by(external_event_id="e2").one()
    assert row.status == "rejected"
    assert "正忙" in ch.send_ack.call_args[0][1]


def test_idle_injects_and_acks(db_session, monkeypatch):
    ch = _make_channel(); conv = _conv(db_session)
    monkeypatch.setattr("src.service.channel.resolve.resolve_active_curator_conversation", lambda db: conv)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "is_active", lambda cid: False)
    monkeypatch.setattr("src.service.agent.orchestrator.curator_injection.inject_curator_instruction",
                        lambda db, conversation, text, **kw: (111, 222))
    msg = InboundMessage(external_user_id="ou_ok", external_chat_id="oc", text="跑日报", external_event_id="e3")
    ch.handle_inbound(db_session, msg)
    row = db_session.query(ChannelInbox).filter_by(external_event_id="e3").one()
    assert row.status == "running" and row.user_message_id == 111 and row.assistant_message_id == 222
    assert "收到" in ch.send_ack.call_args[0][1]


def test_duplicate_event_id(db_session, monkeypatch):
    ch = _make_channel(); conv = _conv(db_session)
    monkeypatch.setattr("src.service.channel.resolve.resolve_active_curator_conversation", lambda db: conv)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "is_active", lambda cid: False)
    monkeypatch.setattr("src.service.agent.orchestrator.curator_injection.inject_curator_instruction",
                        lambda db, conversation, text, **kw: (1, 2))
    msg = InboundMessage(external_user_id="ou_ok", external_chat_id="oc", text="x", external_event_id="edup")
    ch.handle_inbound(db_session, msg)
    ch.handle_inbound(db_session, msg)  # 第二次去重
    assert db_session.query(ChannelInbox).filter_by(external_event_id="edup").count() == 1

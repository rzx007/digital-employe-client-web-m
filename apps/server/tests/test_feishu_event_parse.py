from types import SimpleNamespace as NS

from src.service.channel.base import InboundMessage
from src.service.channel.feishu_channel import parse_lark_message_event


def _evt(message_type="text", content='{"text":"你好"}', open_id="ou_1",
         chat_id="oc_1", event_id="ev_1"):
    return NS(
        header=NS(event_id=event_id),
        event=NS(
            sender=NS(sender_id=NS(open_id=open_id)),
            message=NS(message_type=message_type, chat_id=chat_id,
                       message_id="om_1", content=content),
        ),
    )


def test_parse_text_ok():
    msg = parse_lark_message_event(_evt())
    assert isinstance(msg, InboundMessage)
    assert msg.external_user_id == "ou_1"
    assert msg.external_chat_id == "oc_1"
    assert msg.external_event_id == "ev_1"
    assert msg.text == "你好"


def test_parse_non_text_returns_none():
    assert parse_lark_message_event(_evt(message_type="image")) is None


def test_parse_missing_fields_returns_none():
    assert parse_lark_message_event(_evt(open_id=None)) is None
    assert parse_lark_message_event(_evt(content="{}")) is None  # 无 text


def test_parse_bad_content_returns_none():
    assert parse_lark_message_event(_evt(content="not-json")) is None

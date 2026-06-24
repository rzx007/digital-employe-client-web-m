import pytest
from src.service.channel.base import Channel, InboundMessage


def test_inbound_message_fields():
    m = InboundMessage(external_user_id="ou", external_chat_id="oc",
                       text="hi", external_event_id="e1")
    assert m.text == "hi"


def test_channel_is_abstract():
    with pytest.raises(TypeError):
        Channel()

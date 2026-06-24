import pytest
from sqlalchemy.exc import IntegrityError
from src.models.channel_inbox import ChannelInbox


def test_external_event_id_unique(db_session):
    db_session.add(ChannelInbox(channel="feishu", external_event_id="evt-1",
                                external_user_id="ou_x", external_chat_id="oc_y",
                                workspace_id=1, conversation_id=2, status="acked"))
    db_session.commit()
    db_session.add(ChannelInbox(channel="feishu", external_event_id="evt-1",
                                external_user_id="ou_x", external_chat_id="oc_y",
                                workspace_id=1, conversation_id=2, status="acked"))
    with pytest.raises(IntegrityError):
        db_session.commit()

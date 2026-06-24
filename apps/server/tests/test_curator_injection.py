from unittest.mock import MagicMock

from src.models.conversation import Conversation, ConversationMessage


def test_inject_creates_messages_and_starts_stream(db_session, monkeypatch):
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    fake_loop = MagicMock()
    monkeypatch.setattr(
        "src.service.agent.orchestrator.curator_injection._get_main_loop",
        lambda: fake_loop)
    from src.service.agent.orchestrator.curator_injection import inject_curator_instruction
    user_id, asst_id = inject_curator_instruction(
        db_session, conv, "帮我跑日报", source="feishu")

    msgs = db_session.query(ConversationMessage).filter_by(conversation_id=conv.id).all()
    assert {m.role for m in msgs} == {"user", "assistant"}
    user_msg = next(m for m in msgs if m.role == "user")
    assert user_msg.content == "帮我跑日报"
    asst_msg = next(m for m in msgs if m.role == "assistant")
    assert (user_id, asst_id) == (user_msg.id, asst_msg.id)
    fake_loop.call_soon_threadsafe.assert_called_once()

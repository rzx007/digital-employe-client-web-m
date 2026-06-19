"""resume 时把滞后的 streaming/queued DB 消息落成终态，杜绝前端 resume 热循环。

复现的线上故障：某轮 stream 在 registry 里已是 cancelled（终态），但该轮的
assistant 消息在 DB 里仍是 stream_state='streaming'。前端从 DB 读到 streaming →
反复 resume → 后端 get_stream_status 走「stream already ended」分支只通知不落库 →
DB 永远 streaming → 死循环（前端一直转圈+闪屏）。

修法：resume 命中「已终态」分支时，先把 DB 里仍 streaming/queued 的该会话末尾
assistant 消息落成 terminal_status，保证 DB 与 registry 收敛，前端下一拍 resume
决策（看 streamState !== 'streaming'）不再放行。
"""

from __future__ import annotations

from src.models.conversation import Conversation, ConversationMessage
from src.service.chat_service import reconcile_stale_stream_state_on_resume


def _seed_conv(db) -> int:
    conv = Conversation(id=756, workspace_id=1, target_type="employee", target_id=1)
    db.add(conv)
    db.commit()
    return conv.id


def test_reconciles_lingering_streaming_to_terminal(db_session) -> None:
    conv_id = _seed_conv(db_session)
    msg = ConversationMessage(
        id=3937,
        conversation_id=conv_id,
        role="assistant",
        stream_state="streaming",
        stream_cursor=0,
    )
    db_session.add(msg)
    db_session.commit()

    changed = reconcile_stale_stream_state_on_resume(
        db_session, conv_id, terminal_status="cancelled"
    )

    assert changed is True
    db_session.refresh(msg)
    assert msg.stream_state == "cancelled"


def test_reconciles_queued_too(db_session) -> None:
    conv_id = _seed_conv(db_session)
    msg = ConversationMessage(
        id=4001,
        conversation_id=conv_id,
        role="assistant",
        stream_state="queued",
    )
    db_session.add(msg)
    db_session.commit()

    changed = reconcile_stale_stream_state_on_resume(
        db_session, conv_id, terminal_status="error"
    )

    assert changed is True
    db_session.refresh(msg)
    assert msg.stream_state == "error"


def test_noop_when_already_terminal(db_session) -> None:
    conv_id = _seed_conv(db_session)
    msg = ConversationMessage(
        id=4002,
        conversation_id=conv_id,
        role="assistant",
        stream_state="completed",
    )
    db_session.add(msg)
    db_session.commit()

    changed = reconcile_stale_stream_state_on_resume(
        db_session, conv_id, terminal_status="cancelled"
    )

    # 已是终态 → 不动它（不能把 completed 改成 cancelled）
    assert changed is False
    db_session.refresh(msg)
    assert msg.stream_state == "completed"


def test_noop_when_no_assistant_message(db_session) -> None:
    conv_id = _seed_conv(db_session)
    changed = reconcile_stale_stream_state_on_resume(
        db_session, conv_id, terminal_status="cancelled"
    )
    assert changed is False


def test_interrupted_terminal_not_overwritten_to_cancelled(db_session) -> None:
    # interrupted（HITL 暂停）是有效终态，不该被 resume 落成 cancelled
    conv_id = _seed_conv(db_session)
    msg = ConversationMessage(
        id=4003,
        conversation_id=conv_id,
        role="assistant",
        stream_state="interrupted",
    )
    db_session.add(msg)
    db_session.commit()

    changed = reconcile_stale_stream_state_on_resume(
        db_session, conv_id, terminal_status="cancelled"
    )
    assert changed is False
    db_session.refresh(msg)
    assert msg.stream_state == "interrupted"

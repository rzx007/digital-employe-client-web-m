import json
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


def test_inject_passes_text_and_queued_fallback(db_session, monkeypatch):
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    # 捕获投递到主 loop 的闭包并稍后执行，从而触发 registry.start
    captured = {}
    fake_loop = MagicMock()
    fake_loop.call_soon_threadsafe.side_effect = (
        lambda fn: captured.setdefault("fn", fn))
    monkeypatch.setattr(
        "src.service.agent.orchestrator.curator_injection._get_main_loop",
        lambda: fake_loop)

    # registry / get_orchestrator_agent 在 _start_on_main 内是函数内 lazy import，
    # 故必须 patch 源头模块属性才能命中。
    fake_registry = MagicMock()
    fake_registry.start.return_value = object()  # 非 REJECTED，避免走 reset_context
    monkeypatch.setattr(
        "src.service.stream_registry.registry", fake_registry)
    monkeypatch.setattr(
        "src.service.agent.orchestrator.get_orchestrator_agent",
        lambda *a, **k: MagicMock())

    from src.service.agent.orchestrator.curator_injection import (
        inject_curator_instruction,
    )
    inject_curator_instruction(
        db_session, conv, "跑日报",
        source="feishu", priority=7, initial_msg_state="queued")

    # ② queued 兜底文案
    asst = db_session.query(ConversationMessage).filter_by(
        conversation_id=conv.id, role="assistant").one()
    assert "队列" in (asst.content or "")

    # 执行被捕获的主 loop 闭包，触发 registry.start
    assert "fn" in captured
    captured["fn"]()

    # registry.start 全用关键字参数调用
    _, kwargs = fake_registry.start.call_args
    # ① messages[0].content == text
    assert kwargs["messages"][0]["content"] == "跑日报"
    # ③ source / priority 透传
    assert kwargs["source"] == "feishu"
    assert kwargs["priority"] == 7


def test_inject_pushes_turn_started_event_on_start(db_session, monkeypatch):
    """成功起流（非 REJECTED）→ 必须推 orchestrator_turn_started，
    让前端 refetch→resume→实时显示服务端自发起的总管 turn（后台命令唤醒等）。"""
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    captured = {}
    fake_loop = MagicMock()
    fake_loop.call_soon_threadsafe.side_effect = (
        lambda fn: captured.setdefault("fn", fn))
    monkeypatch.setattr(
        "src.service.agent.orchestrator.curator_injection._get_main_loop",
        lambda: fake_loop)

    fake_registry = MagicMock()
    fake_registry.start.return_value = object()  # 非 REJECTED
    monkeypatch.setattr("src.service.stream_registry.registry", fake_registry)
    monkeypatch.setattr(
        "src.service.agent.orchestrator.get_orchestrator_agent",
        lambda *a, **k: MagicMock())

    pushes = []
    import src.service.workspace_events as we
    monkeypatch.setattr(
        we.WorkspaceEventBus, "push",
        classmethod(lambda cls, ws, ev: pushes.append((ws, ev))))

    from src.service.agent.orchestrator.curator_injection import (
        inject_curator_instruction,
    )
    inject_curator_instruction(db_session, conv, "后台命令已结束", source="background_wake")
    captured["fn"]()

    turn_events = [
        (ws, ev) for ws, ev in pushes
        if ev.get("type") == "orchestrator_turn_started"
    ]
    assert len(turn_events) == 1
    ws, ev = turn_events[0]
    assert ws == conv.workspace_id
    assert ev["orchestrator_conversation_id"] == conv.id


def test_inject_no_turn_started_event_when_rejected(db_session, monkeypatch):
    """起流被拒（REJECTED，会话已有活跃/排队流）→ 不推 orchestrator_turn_started。"""
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    captured = {}
    fake_loop = MagicMock()
    fake_loop.call_soon_threadsafe.side_effect = (
        lambda fn: captured.setdefault("fn", fn))
    monkeypatch.setattr(
        "src.service.agent.orchestrator.curator_injection._get_main_loop",
        lambda: fake_loop)

    from src.service.agent_stream_queue import StartResult
    fake_registry = MagicMock()
    fake_registry.start.return_value = StartResult.REJECTED
    monkeypatch.setattr("src.service.stream_registry.registry", fake_registry)
    monkeypatch.setattr(
        "src.service.agent.orchestrator.get_orchestrator_agent",
        lambda *a, **k: MagicMock())

    pushes = []
    import src.service.workspace_events as we
    monkeypatch.setattr(
        we.WorkspaceEventBus, "push",
        classmethod(lambda cls, ws, ev: pushes.append((ws, ev))))

    from src.service.agent.orchestrator.curator_injection import (
        inject_curator_instruction,
    )
    inject_curator_instruction(db_session, conv, "x", source="background_wake")
    captured["fn"]()

    assert not [
        ev for _, ev in pushes
        if ev.get("type") == "orchestrator_turn_started"
    ]


def test_inject_marks_channel_source_on_user_msg(db_session, monkeypatch):
    """飞书等 channel 来源给 user 消息 extra_meta 打 channel 标。"""
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    fake_loop = MagicMock()
    monkeypatch.setattr(
        "src.service.agent.orchestrator.curator_injection._get_main_loop",
        lambda: fake_loop)
    from src.service.agent.orchestrator.curator_injection import (
        inject_curator_instruction,
    )
    inject_curator_instruction(db_session, conv, "帮我跑日报", source="feishu")

    user_msg = db_session.query(ConversationMessage).filter_by(
        conversation_id=conv.id, role="user").one()
    assert json.loads(user_msg.extra_meta) == {"channel": "feishu"}


def test_inject_no_channel_mark_for_scheduled_source(db_session, monkeypatch):
    """scheduled 等非 channel 来源不打标，user 消息 extra_meta 为 None。"""
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    fake_loop = MagicMock()
    monkeypatch.setattr(
        "src.service.agent.orchestrator.curator_injection._get_main_loop",
        lambda: fake_loop)
    from src.service.agent.orchestrator.curator_injection import (
        inject_curator_instruction,
    )
    inject_curator_instruction(db_session, conv, "跑日报", source="scheduled")

    user_msg = db_session.query(ConversationMessage).filter_by(
        conversation_id=conv.id, role="user").one()
    assert user_msg.extra_meta is None

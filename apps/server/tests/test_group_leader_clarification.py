"""覆盖范围：组长 brief 构建、HITL interrupt_on 配置、中断澄清消息投影到群时间线。"""

from __future__ import annotations

import json

from sqlalchemy import select

from src.models.conversation import Conversation, ConversationMessage
from src.models.group_room import GroupRoom
from src.service.group_room_service import (
    GroupRoomService,
    build_leader_brief,
    project_member_conversation_if_in_room,
)
from src.service.agent.destructive_hitl import (
    DESTRUCTIVE_HITL_TOOLS,
    build_orchestrator_interrupt_on,
    resolve_orchestrator_interrupt_on,
)


def test_leader_brief_includes_clarify_branch() -> None:
    brief = build_leader_brief(question="帮我写个文档", roster="- 张三（员工ID: 1）")
    assert "submit_clarifying_questions" in brief
    assert "模糊" in brief or "信息不足" in brief
    assert "帮我写个文档" in brief
    assert "张三" in brief


def test_leader_brief_default_waits_for_user_confirm() -> None:
    """默认（未开自动确认）：brief 应让组长建计划后停下等用户确认，不要自动 confirm。"""
    brief = build_leader_brief(question="做个报告", roster="- 张三（员工ID: 1）")
    assert "确认执行" in brief
    assert "由用户点击确认后才会派活" in brief
    assert "不要" in brief and "confirm_orchestration_plan" in brief


def test_leader_brief_auto_confirm_executes_immediately() -> None:
    """开启自动确认：brief 应允许组长立即 confirm_orchestration_plan 执行。"""
    brief = build_leader_brief(
        question="做个报告", roster="- 张三（员工ID: 1）", auto_confirm=True
    )
    assert "立即 confirm_orchestration_plan" in brief
    assert "本群已开启自动确认" in brief


def test_orchestrator_interrupt_on_has_clarify() -> None:
    interrupt_on = build_orchestrator_interrupt_on(None)
    assert "submit_clarifying_questions" in interrupt_on
    assert "respond" in interrupt_on["submit_clarifying_questions"]["allowed_decisions"]


def test_orchestrator_interrupt_on_skip_flag_does_not_remove_clarify() -> None:
    """传 skip_destructive_hitl=True 仍含 submit_clarifying_questions。"""
    interrupt_on = build_orchestrator_interrupt_on({"skip_destructive_hitl": True})
    assert "submit_clarifying_questions" in interrupt_on
    assert "respond" in interrupt_on["submit_clarifying_questions"]["allowed_decisions"]


def test_resolve_interrupt_on_clarify_only_keeps_clarify_drops_destructive() -> None:
    """组长派活/resume 用的 clarify_only 模式：只挂澄清中断，删除/文档方案全不挂。

    回归保护：曾因组长 agent 走 enable_hitl=False → interrupt_on=None，
    submit_clarifying_questions 不挂起、直接返回「已收到回答」串，组长凭空往下派活。
    """
    interrupt_on = resolve_orchestrator_interrupt_on(
        enable_hitl=False, clarify_only_hitl=True, session_flags=None
    )
    assert interrupt_on is not None
    assert "submit_clarifying_questions" in interrupt_on
    assert "respond" in interrupt_on["submit_clarifying_questions"]["allowed_decisions"]
    # 删除类与文档方案中断不得出现（群里无审批者，否则永久挂起）
    for name in DESTRUCTIVE_HITL_TOOLS:
        assert name not in interrupt_on
    assert "submit_document_plan" not in interrupt_on


def test_resolve_interrupt_on_all_off_is_none() -> None:
    """组长汇总等场景：既无澄清也无审批者 → 完全不挂 HITL。"""
    assert (
        resolve_orchestrator_interrupt_on(
            enable_hitl=False, clarify_only_hitl=False, session_flags=None
        )
        is None
    )


def test_resolve_interrupt_on_full_hitl_has_destructive_and_clarify() -> None:
    """真人会话：全量 HITL，澄清 + 删除类都在。"""
    interrupt_on = resolve_orchestrator_interrupt_on(
        enable_hitl=True, clarify_only_hitl=False, session_flags=None
    )
    assert interrupt_on is not None
    assert "submit_clarifying_questions" in interrupt_on
    assert all(name in interrupt_on for name in DESTRUCTIVE_HITL_TOOLS)


def _make_room_with_leader(db_session, workspace):
    group_conv = Conversation(
        workspace_id=workspace.id, target_type="group", target_id=1, title="群"
    )
    db_session.add(group_conv)
    db_session.flush()
    leader_conv = Conversation(
        workspace_id=workspace.id,
        target_type="group_leader",
        target_id=group_conv.id,
        title="组长",
    )
    db_session.add(leader_conv)
    db_session.flush()
    room = GroupRoom(
        workspace_id=workspace.id,
        room_conversation_id=group_conv.id,
        leader_conversation_id=leader_conv.id,
    )
    db_session.add(room)
    db_session.commit()
    return room, group_conv, leader_conv


def test_interrupted_leader_projects_clarify_card(
    db_session, db_engine, workspace, monkeypatch
):
    from sqlalchemy.orm import sessionmaker

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    parts = [{"type": "clarifying_questions", "questions": ["主题?", "受众?"]}]
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id,
        role="assistant",
        content="",
        stream_state="interrupted",
        message_parts=json.dumps(parts, ensure_ascii=False),
    )
    db_session.add(interrupted)
    db_session.commit()
    interrupted_id = interrupted.id

    project_member_conversation_if_in_room(leader_conv.id, "interrupted")

    read = TestSession()
    card = read.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == group_conv.id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is not None
    meta = json.loads(card.extra_meta or "{}")
    assert meta["clarify_target_conversation_id"] == leader_conv.id
    assert meta["clarify_message_id"] == interrupted_id
    assert "clarifying_questions" in (card.message_parts or "")
    read.close()


def test_interrupted_leader_no_message_does_not_post(
    db_session, db_engine, workspace, monkeypatch
):
    """组长会话无任何 assistant 消息时，interrupted 投影应静默 return（无卡片，不抛异常）。"""
    from sqlalchemy.orm import sessionmaker

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    # 故意不添加任何 assistant 消息

    project_member_conversation_if_in_room(leader_conv.id, "interrupted")

    read = TestSession()
    card = read.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == group_conv.id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is None, "无 assistant 消息时不应在群时间线生成任何卡片"
    read.close()


def test_interrupted_leader_no_parts_posts_fallback(
    db_session, db_engine, workspace, monkeypatch
):
    """组长会话有 interrupted assistant 消息但 message_parts 为 None 时，
    应投影纯文本兜底卡片（extra_meta 含 clarify_target_conversation_id/clarify_message_id，内容非空）。
    """
    from sqlalchemy.orm import sessionmaker

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id,
        role="assistant",
        content="",
        stream_state="interrupted",
        message_parts=None,  # 无结构化 parts
    )
    db_session.add(interrupted)
    db_session.commit()
    interrupted_id = interrupted.id

    project_member_conversation_if_in_room(leader_conv.id, "interrupted")

    read = TestSession()
    card = read.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == group_conv.id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is not None, "无 parts 时仍应投影兜底卡片"
    meta = json.loads(card.extra_meta or "{}")
    assert meta["clarify_target_conversation_id"] == leader_conv.id
    assert meta["clarify_message_id"] == interrupted_id
    assert card.content, "兜底内容不能为空"
    read.close()


def test_leader_error_projects_clear_reason(
    db_session, db_engine, workspace, monkeypatch
):
    """组长流 error 时，群时间线应带「具体失败原因」而非模糊的「（组长error）」。"""
    from sqlalchemy.orm import sessionmaker

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    # 出错时 stream_registry 把可读原因写进 content + extra_meta.error_message
    failed = ConversationMessage(
        conversation_id=leader_conv.id,
        role="assistant",
        content="请求模型 qwen-max 超时，请稍后重试。",
        stream_state="error",
        extra_meta=json.dumps(
            {"error_message": "请求模型 qwen-max 超时，请稍后重试。"},
            ensure_ascii=False,
        ),
    )
    db_session.add(failed)
    db_session.commit()

    project_member_conversation_if_in_room(leader_conv.id, "error")

    read = TestSession()
    card = read.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == group_conv.id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is not None
    assert "组长error" not in (card.content or ""), "不应再出现模糊的「组长error」"
    assert "执行失败" in (card.content or "")
    assert "超时" in (card.content or ""), "应把真实失败原因带到群里"
    meta = json.loads(card.extra_meta or "{}")
    assert meta.get("stream_state") == "error"
    read.close()


def test_leader_error_without_reason_gives_actionable_hint(
    db_session, db_engine, workspace, monkeypatch
):
    """组长流 error 但没有任何可读原因时，应给出可操作的兜底提示（而非空 error）。"""
    from sqlalchemy.orm import sessionmaker

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    # 无 assistant 消息：拿不到原因
    project_member_conversation_if_in_room(leader_conv.id, "error")

    read = TestSession()
    card = read.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == group_conv.id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is not None
    assert "执行失败" in (card.content or "")
    assert "模型设置" in (card.content or ""), "无原因时应引导检查模型设置"
    read.close()


def test_approve_trigger_group_leader_branch(db_session, db_engine, workspace, monkeypatch):
    """approve_trigger 对 group_leader 会话应重建 agent、注册 relay 并调 approve_and_resume。"""
    import asyncio

    from sqlalchemy.orm import sessionmaker

    import src.service.group_room_service as grs
    from src.service.chat_service import ChatService

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)

    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id,
        role="assistant",
        content="",
        stream_state="interrupted",
        message_parts=json.dumps([{"type": "clarifying_questions"}], ensure_ascii=False),
        extra_meta="{}",
    )
    db_session.add(interrupted)
    db_session.commit()

    monkeypatch.setattr(
        "src.service.agent.orchestrator.get_orchestrator_agent",
        lambda **kw: object(),
    )
    captured = {}

    async def fake_resume(**kw):
        captured.update(kw)
        from src.service.agent_stream_queue import StartResult
        return StartResult.STARTED

    from src.service.stream_registry import registry
    monkeypatch.setattr(registry, "approve_and_resume", fake_resume)

    result = asyncio.run(ChatService.approve_trigger(
        db_session, leader_conv.id, interrupted.id,
        decisions=[{"type": "respond", "message": "市场周报,管理层,1页,markdown"}],
        auth_token="t",
    ))

    assert result["accepted"] is True
    assert leader_conv.id in grs._GROUP_STREAM_RELAY          # relay 已重注册
    assert captured["orchestrator_conversation_id"] == leader_conv.id
    assert captured["orchestrator_workspace_id"] == workspace.id
    assert captured["orchestrator_owned_db"] is not None       # 独立 leader_db
    assert captured["decisions"][0]["type"] == "respond"
    assert captured["decisions"][0]["message"] == "市场周报,管理层,1页,markdown"  # Minor


def test_approve_trigger_group_leader_rejected_no_relay_residue(
    db_session, db_engine, workspace, monkeypatch
):
    """REJECTED 时：leader_db 被 close（C-1）、relay 无残留（C-2）。"""
    import asyncio

    from sqlalchemy.orm import sessionmaker

    import src.service.group_room_service as grs
    from src.service.chat_service import ChatService

    TestSession = sessionmaker(bind=db_engine)
    monkeypatch.setattr("src.db.session.get_session_local", lambda: TestSession)

    # 独立的 room/leader_conv，避免与其它测试共享 conversation_id
    room2, group_conv2, leader_conv2 = _make_room_with_leader(db_session, workspace)
    interrupted2 = ConversationMessage(
        conversation_id=leader_conv2.id,
        role="assistant",
        content="",
        stream_state="interrupted",
        message_parts=json.dumps([{"type": "clarifying_questions"}], ensure_ascii=False),
        extra_meta="{}",
    )
    db_session.add(interrupted2)
    db_session.commit()

    monkeypatch.setattr(
        "src.service.agent.orchestrator.get_orchestrator_agent",
        lambda **kw: object(),
    )

    async def fake_resume_rejected(**kw):
        from src.service.agent_stream_queue import StartResult
        return StartResult.REJECTED

    from src.service.stream_registry import registry
    monkeypatch.setattr(registry, "approve_and_resume", fake_resume_rejected)

    # 确保测试开始前 relay 中没有该 conversation_id
    grs._GROUP_STREAM_RELAY.pop(leader_conv2.id, None)

    result = asyncio.run(ChatService.approve_trigger(
        db_session, leader_conv2.id, interrupted2.id,
        decisions=[{"type": "respond", "message": "测试"}],
        auth_token="t",
    ))

    assert result["accepted"] is False                              # 拒绝返回
    assert leader_conv2.id not in grs._GROUP_STREAM_RELAY           # C-2：relay 无残留


def test_mark_clarify_card_approved(db_session, workspace):
    """approve 后回标群投影卡片 approved_at，避免 refetch 卡片复活；幂等且不误伤。"""
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    leader_msg_id = 4321

    # 群里那条澄清投影卡片（extra_meta 指向组长会话 + 组长中断消息）
    card = ConversationMessage(
        conversation_id=group_conv.id,
        role="assistant",
        content="我需要先确认一些信息",
        extra_meta=json.dumps(
            {
                "clarify_target_conversation_id": leader_conv.id,
                "clarify_message_id": leader_msg_id,
            },
            ensure_ascii=False,
        ),
    )
    # 一条不相关的群消息，确保不被误标
    other = ConversationMessage(
        conversation_id=group_conv.id, role="assistant", content="无关消息",
    )
    db_session.add_all([card, other])
    db_session.commit()

    hit = GroupRoomService.mark_clarify_card_approved(
        db_session,
        room_conversation_id=group_conv.id,
        leader_conversation_id=leader_conv.id,
        leader_message_id=leader_msg_id,
        approved_at="2026-06-06T00:00:00+00:00",
    )
    db_session.commit()
    db_session.refresh(card)
    db_session.refresh(other)

    assert hit is True
    assert json.loads(card.extra_meta)["approved_at"] == "2026-06-06T00:00:00+00:00"
    assert other.extra_meta is None  # 未被误伤

    # 幂等：再标一次（用不同时间）不应覆盖已有 approved_at
    hit2 = GroupRoomService.mark_clarify_card_approved(
        db_session,
        room_conversation_id=group_conv.id,
        leader_conversation_id=leader_conv.id,
        leader_message_id=leader_msg_id,
        approved_at="2099-01-01T00:00:00+00:00",
    )
    db_session.commit()
    db_session.refresh(card)
    assert hit2 is True
    assert json.loads(card.extra_meta)["approved_at"] == "2026-06-06T00:00:00+00:00"


def test_mark_clarify_card_approved_no_match_returns_false(db_session, workspace):
    """无匹配投影卡片时返回 False，不抛异常。"""
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    assert (
        GroupRoomService.mark_clarify_card_approved(
            db_session,
            room_conversation_id=group_conv.id,
            leader_conversation_id=leader_conv.id,
            leader_message_id=999,
            approved_at="2026-06-06T00:00:00+00:00",
        )
        is False
    )


def test_leader_awaiting_clarification(db_session, workspace):
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    # 无 assistant 消息 → 非待澄清
    assert GroupRoomService.leader_awaiting_clarification(db_session, room) is False
    # 加一条 interrupted assistant 消息 → 待澄清
    db_session.add(ConversationMessage(
        conversation_id=leader_conv.id, role="assistant", content="",
        stream_state="interrupted",
        message_parts=json.dumps([{"type": "clarifying_questions"}], ensure_ascii=False),
    ))
    db_session.commit()
    assert GroupRoomService.leader_awaiting_clarification(db_session, room) is True
    # completed 消息不算待澄清
    db_session.add(ConversationMessage(
        conversation_id=leader_conv.id, role="assistant", content="done",
        stream_state="completed",
    ))
    db_session.commit()
    assert GroupRoomService.leader_awaiting_clarification(db_session, room) is False


def test_handle_group_message_fallback_resume(db_session, workspace, monkeypatch):
    """待澄清态下普通消息走 approve_trigger 兜底 resume，而非重新 dispatch_to_leader。"""
    import asyncio

    # suppress WorkspaceEventBus.push（post_to_timeline 内部调用，测试无需真实推送）
    monkeypatch.setattr(
        "src.service.workspace_events.WorkspaceEventBus.push",
        lambda *a, **kw: None,
    )

    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)

    # 组长会话有一条 interrupted 消息 → leader_awaiting_clarification = True
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id,
        role="assistant",
        content="",
        stream_state="interrupted",
        message_parts=json.dumps([{"type": "clarifying_questions"}], ensure_ascii=False),
    )
    db_session.add(interrupted)
    db_session.commit()

    approve_called_with: dict = {}
    dispatched_to_leader: list = []

    async def fake_approve_trigger(db, conv_id, msg_id, decisions, auth_token=None):
        approve_called_with.update(
            {"conv_id": conv_id, "msg_id": msg_id, "decisions": decisions}
        )
        return {"accepted": True}

    # 准备一个真实但尚未运行的 event loop，供 run_coroutine_threadsafe 使用
    real_loop = asyncio.new_event_loop()

    monkeypatch.setattr(
        "src.service.group_room_service.GroupRoomService.dispatch_to_leader",
        lambda *a, **kw: dispatched_to_leader.append(True) or 0,
    )
    monkeypatch.setattr(
        "src.service.chat_service.ChatService.approve_trigger",
        fake_approve_trigger,
    )

    # handle_group_message 里局部 import get_main_loop，monkeypatch 模块属性
    monkeypatch.setattr(
        "src.service.agent.orchestrator.runtime.get_main_loop",
        lambda: real_loop,
    )

    from src.service.group_room_service import GroupRoomService

    result = GroupRoomService.handle_group_message(
        db_session,
        group_conv,
        question="市场周报,管理层,1页,markdown",
        extra_meta=None,
        auth_token="tok",
    )

    # 启动 loop 把 run_coroutine_threadsafe 积压的任务跑完
    real_loop.run_until_complete(asyncio.sleep(0))
    real_loop.close()

    # 不走 dispatch_to_leader
    assert not dispatched_to_leader, "兜底路径不应再调 dispatch_to_leader"
    # 返回 note 正确
    assert result["note"] == "已作为澄清作答恢复组长"
    # approve_trigger 被调用，目标是组长会话 + interrupted 消息
    assert approve_called_with.get("conv_id") == leader_conv.id, (
        f"approve_trigger 未被调用或 conv_id 不符，实际: {approve_called_with}"
    )
    assert approve_called_with.get("msg_id") == interrupted.id
    assert approve_called_with["decisions"][0]["type"] == "respond"
    assert "市场周报" in approve_called_with["decisions"][0]["message"]

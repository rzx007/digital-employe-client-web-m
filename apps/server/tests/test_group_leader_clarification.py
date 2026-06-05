from __future__ import annotations

from src.service.group_room_service import build_leader_brief
from src.service.agent.destructive_hitl import build_orchestrator_interrupt_on


def test_leader_brief_includes_clarify_branch() -> None:
    brief = build_leader_brief(question="帮我写个文档", roster="- 张三（员工ID: 1）")
    assert "submit_clarifying_questions" in brief
    assert "模糊" in brief or "信息不足" in brief
    assert "帮我写个文档" in brief
    assert "张三" in brief


def test_orchestrator_interrupt_on_has_clarify() -> None:
    interrupt_on = build_orchestrator_interrupt_on(None)
    assert "submit_clarifying_questions" in interrupt_on

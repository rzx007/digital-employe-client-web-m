"""external_dir_mode 真正影响 interrupt_on：orchestrator/employee 两侧接线语义。

不构造完整 agent（重依赖模型/deepagents），而是复刻两处接线在 create_deep_agent
之前对 interrupt_on 的最终计算：
- orchestrator: resolve_orchestrator_interrupt_on(...) → strip_external_dir_interrupt(_, mode)
- employee:     dict(HITL_INTERRUPT_ON)            → strip_external_dir_interrupt(_, mode)
mode 来自会话 session_flags（经 set_external_dir_mode 落库、get_external_dir_mode 读回），
确保「会话级三态模式」一路打通到 interrupt_on。
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.destructive_hitl import (
    get_session_flags,
    resolve_orchestrator_interrupt_on,
)
from src.service.agent.external_dir_request_tool import (
    REQUEST_EXTERNAL_DIR_TOOL_NAME,
    strip_external_dir_interrupt,
)
from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON
from src.service.agent.path_authorization import (
    get_external_dir_mode,
    set_external_dir_mode,
)


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def _orchestrator_interrupt_on(db: Session, conversation_id: int) -> dict | None:
    """复刻 get_orchestrator_agent 内 enable_hitl 路径的 interrupt_on 终值。"""
    mode = get_external_dir_mode(db, conversation_id)
    session_flags = get_session_flags(db, conversation_id)
    interrupt_on = resolve_orchestrator_interrupt_on(
        enable_hitl=True,
        clarify_only_hitl=False,
        session_flags=session_flags,
    )
    if interrupt_on is not None:
        interrupt_on = strip_external_dir_interrupt(interrupt_on, mode)
    return interrupt_on


def _employee_interrupt_on(db: Session, conversation_id: int) -> dict:
    """复刻 get_agent(employee) 内 enable_hitl 路径的 interrupt_on 终值。"""
    mode = get_external_dir_mode(db, conversation_id)
    return strip_external_dir_interrupt(dict(HITL_INTERRUPT_ON), mode)


# --- orchestrator ---------------------------------------------------------


def test_orchestrator_ask_keeps_request_tool(db_session, conversation):
    # 默认 ask：保留弹卡
    result = _orchestrator_interrupt_on(db_session, conversation.id)
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in result


def test_orchestrator_auto_strips_request_tool(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "auto")
    result = _orchestrator_interrupt_on(db_session, conversation.id)
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME not in result
    # 其它 HITL 中断不受影响
    assert "submit_clarifying_questions" in result


def test_orchestrator_deny_strips_request_tool(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "deny")
    result = _orchestrator_interrupt_on(db_session, conversation.id)
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME not in result


# --- employee -------------------------------------------------------------


def test_employee_ask_keeps_request_tool(db_session, conversation):
    result = _employee_interrupt_on(db_session, conversation.id)
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in result


def test_employee_auto_strips_request_tool(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "auto")
    result = _employee_interrupt_on(db_session, conversation.id)
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME not in result
    assert "submit_clarifying_questions" in result


def test_employee_deny_strips_request_tool(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "deny")
    result = _employee_interrupt_on(db_session, conversation.id)
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME not in result

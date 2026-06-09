from src.service.agent.bug_report_tool import (
    BUG_REPORT_INTERRUPT_ON,
    submit_bug_report,
)
from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON
from src.service.hitl_pending_parts import HITL_TOOL_NAMES


def test_interrupt_registered():
    assert "submit_bug_report" in BUG_REPORT_INTERRUPT_ON
    assert "submit_bug_report" in HITL_INTERRUPT_ON


def test_in_hitl_tool_allowlist_so_pending_card_renders():
    # 不在白名单则 build_pending_hitl_parts 不产出待确认 part，前端无确认卡可渲染
    assert "submit_bug_report" in HITL_TOOL_NAMES


def test_tool_only_opens_form_does_not_submit():
    # 工具仅弹表单、不自己提交（真正提交由前端表单卡直接发后台，避免截图进模型上下文）
    out = submit_bug_report.invoke({})
    assert isinstance(out, str) and out
    assert "表单" in out


def test_tool_accepts_optional_fields_without_error():
    out = submit_bug_report.invoke(
        {"title": "崩溃", "description": "点导出闪退", "include_logs": True}
    )
    assert isinstance(out, str) and out

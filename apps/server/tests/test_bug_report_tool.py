from unittest.mock import patch

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


def test_submit_invokes_service_and_reports_result():
    with patch(
        "src.service.agent.bug_report_tool.feedback_service.submit_feedback",
        return_value={"ok": True, "message": "已提交反馈。", "remote": {"ticket": "B-9"}},
    ) as sf:
        out = submit_bug_report.invoke({
            "title": "崩溃",
            "description": "点击导出闪退",
            "repro_steps": "1.打开 2.点导出",
            "expected": "导出成功",
            "actual": "闪退",
            "include_logs": False,
        })
    assert "已提交" in out
    assert "B-9" in out
    payload = sf.call_args[0][0]
    assert payload["title"] == "崩溃"
    assert "env" in payload
    assert "logs" not in payload


def test_submit_attaches_logs_when_requested():
    with patch(
        "src.service.agent.bug_report_tool.feedback_service.collect_logs",
        return_value="LOGCONTENT",
    ), patch(
        "src.service.agent.bug_report_tool.feedback_service.submit_feedback",
        return_value={"ok": True, "message": "已提交反馈。", "remote": None},
    ) as sf:
        submit_bug_report.invoke({
            "title": "t", "description": "d", "repro_steps": "",
            "expected": "", "actual": "", "include_logs": True,
        })
    assert sf.call_args[0][0]["logs"] == "LOGCONTENT"


def test_submit_attaches_screenshot_when_provided():
    dat = "data:image/png;base64,AAAA"
    with patch(
        "src.service.agent.bug_report_tool.feedback_service.submit_feedback",
        return_value={"ok": True, "message": "已提交反馈。", "remote": None},
    ) as sf:
        submit_bug_report.invoke({
            "title": "t", "description": "d", "repro_steps": "",
            "expected": "", "actual": "", "include_logs": False,
            "screenshot": dat,
        })
    assert sf.call_args[0][0]["screenshot"] == dat


def test_no_screenshot_key_when_empty():
    with patch(
        "src.service.agent.bug_report_tool.feedback_service.submit_feedback",
        return_value={"ok": True, "message": "已提交反馈。", "remote": None},
    ) as sf:
        submit_bug_report.invoke({
            "title": "t", "description": "d", "repro_steps": "",
            "expected": "", "actual": "", "include_logs": False,
        })
    assert "screenshot" not in sf.call_args[0][0]

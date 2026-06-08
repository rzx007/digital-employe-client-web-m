from __future__ import annotations

import logging

from langchain_core.tools import tool

from src.service import feedback_service

logger = logging.getLogger(__name__)

BUG_REPORT_INTERRUPT_ON = {
    "submit_bug_report": {
        "allowed_decisions": ["approve", "reject", "edit"],
    },
}


def _best_effort_token() -> str | None:
    """尽力从编排运行时取当前用户 token；取不到返回 None（远端按需识别）。"""
    try:
        from src.service.agent.orchestrator import runtime

        getter = getattr(runtime, "get_auth_token", None)
        if callable(getter):
            return (getter() or "").strip() or None
    except Exception:
        pass
    return None


@tool
def submit_bug_report(
    title: str,
    description: str,
    repro_steps: str = "",
    expected: str = "",
    actual: str = "",
    include_logs: bool = False,
    screenshot: str = "",
) -> str:
    """提交一条 BUG 反馈到官方后台（用户确认后才会真正发送）。

    title: 一句话标题；description: 详细描述；repro_steps: 复现步骤；
    expected/actual: 期望与实际；include_logs: 是否附带最近运行日志（须用户同意）；
    screenshot: 截图 base64 dataURI（由前端确认卡填入，通常无需模型自己填）。
    """
    payload: dict = {
        "title": title,
        "description": description,
        "repro_steps": repro_steps,
        "expected": expected,
        "actual": actual,
        "env": feedback_service.collect_env(),
    }
    if include_logs:
        logs = feedback_service.collect_logs()
        if logs:
            payload["logs"] = logs
    if screenshot:
        payload["screenshot"] = screenshot

    result = feedback_service.submit_feedback(payload, token=_best_effort_token())
    logger.info(
        "bug_report submit ok=%s include_logs=%s", result.get("ok"), include_logs
    )
    if result.get("ok"):
        remote = result.get("remote") or {}
        ticket = remote.get("ticket") if isinstance(remote, dict) else None
        return f"已提交反馈。{('工单号：' + str(ticket)) if ticket else ''}".strip()
    return f"反馈未提交：{result.get('message', '未知错误')}"

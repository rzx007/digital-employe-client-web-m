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
    title: str = "",
    description: str = "",
    repro_steps: str = "",
    expected: str = "",
    actual: str = "",
    include_logs: bool = False,
    screenshot: str = "",
) -> str:
    """弹出 BUG 反馈表单让用户填写并提交（用户在表单里确认后才真正发送）。

    用户一表达反馈意图就**立即调用**本工具弹出表单，**所有字段都可留空**——
    把用户已说的放进对应字段、其余留空即可，**不要逐项追问**。用户会在前端表单卡里
    补全字段、可选附截图，点「提交反馈」后才发送。
    title/description/repro_steps/expected/actual：标题/描述/复现/期望/实际（通常留空由用户填）；
    include_logs：是否附最近日志；screenshot：截图 base64（由前端表单填入，模型无需自填）。
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

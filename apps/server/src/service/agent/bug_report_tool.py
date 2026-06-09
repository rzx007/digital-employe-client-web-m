from __future__ import annotations

import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

BUG_REPORT_INTERRUPT_ON = {
    "submit_bug_report": {
        "allowed_decisions": ["approve", "reject", "edit"],
    },
}


@tool
def submit_bug_report(
    title: str = "",
    description: str = "",
    repro_steps: str = "",
    expected: str = "",
    actual: str = "",
    include_logs: bool = False,
) -> str:
    """弹出 BUG 反馈表单，让用户在表单里填写并提交。

    用户一表达反馈意图就**立即调用**本工具弹出表单，**所有字段都可留空**——
    把用户已说的放进对应字段、其余留空即可，**不要逐项追问**。
    title/description/repro_steps/expected/actual：标题/描述/复现/期望/实际（通常留空由用户填）；
    include_logs：是否默认勾选附带最近日志。

    注意：**真正的提交由前端表单卡直接发往后台**（含可选截图，不经模型上下文）；
    本工具仅负责弹出表单。调用后只需等待用户在表单里操作，不要代填、不要替用户提交。
    """
    logger.info("bug_report form opened (submission handled by frontend card)")
    return "已为用户弹出反馈表单，请等待用户在表单中填写并点「提交反馈」。"

from __future__ import annotations

from langchain_core.tools import tool

DOCUMENT_PLAN_INTERRUPT_ON = {
    "submit_document_plan": {
        "allowed_decisions": ["approve", "reject", "edit"],
    },
}


@tool
def submit_document_plan(
    title: str,
    outline: str,
    open_questions: str = "[]",
    planned_artifacts: str = "[]",
) -> str:
    """提交长文档写作方案（同一次任务仅调用一次）。用户确认后方可 write_file 到 /artifacts/。

    open_questions、planned_artifacts 须为 JSON 字符串，例如 '["问题1"]'、'["/artifacts/a.md"]'。
    """
    return (
        f"方案「{title}」已确认，请按 outline 分章 write_file 到 /artifacts/。"
        f" 计划文件: {planned_artifacts}"
    )

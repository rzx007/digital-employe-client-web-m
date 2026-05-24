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
    """提交长文档写作方案（同一次任务仅调用一次）。用户确认后方可 write_file。

    须先确定 /artifacts/<doc-slug>/（由 title 生成），分章与终稿均在该子目录下，勿写在 /artifacts/ 根目录。
    open_questions、planned_artifacts 须为 JSON 字符串，例如
    '["/artifacts/tech-proposal/chapter-01-背景.md", "/artifacts/tech-proposal/完整版.md"]'。
    """
    return (
        f"方案「{title}」已确认，请按 outline 在 /artifacts/<doc-slug>/ 下分章 write_file。"
        f" 计划文件: {planned_artifacts}"
    )

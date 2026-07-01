from __future__ import annotations

import json

from langchain_core.tools import tool

DOCUMENT_PLAN_INTERRUPT_ON = {
    "submit_document_plan": {
        "allowed_decisions": ["approve", "reject", "edit"],
    },
}


def _parse_json_string_list(raw: str) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return [str(raw).strip()] if str(raw).strip() else []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


def build_document_plan_confirmed_message(
    *,
    title: str,
    outline: str,
    planned_artifacts: str = "[]",
    open_questions: str = "[]",
) -> str:
    """approve 后写入 ToolMessage 的文本；使用换行便于前端 DocumentPlanApprovedSummary 展示。"""
    lines: list[str] = ["方案已确认", ""]

    title_text = (title or "").strip()
    if title_text:
        lines.append(f"标题：{title_text}")
        lines.append("")

    outline_text = (outline or "").strip()
    if outline_text:
        lines.append("大纲：")
        lines.append(outline_text)
        lines.append("")

    artifacts = _parse_json_string_list(planned_artifacts)
    if artifacts:
        lines.append("计划产出：")
        for index, path in enumerate(artifacts, 1):
            lines.append(f"{index}. {path}")
        lines.append("")

    questions = _parse_json_string_list(open_questions)
    if questions:
        lines.append("待确认问题：")
        for index, question in enumerate(questions, 1):
            lines.append(f"{index}. {question}")
        lines.append("")

    lines.append(
        "请按大纲在 /artifacts/<doc-slug>/ 下分章 write_file（勿写在 /artifacts/ 根目录）。"
    )
    return "\n".join(lines)


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
    return build_document_plan_confirmed_message(
        title=title,
        outline=outline,
        planned_artifacts=planned_artifacts,
        open_questions=open_questions,
    )

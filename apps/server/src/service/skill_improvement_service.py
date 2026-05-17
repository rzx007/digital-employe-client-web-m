"""技能评分改进建议服务。

当用户对技能的评分低于 3 分且带有评论时，自动调用 LLM 分析
改进方向，在技能目录下生成 improvement-suggestion.md。
"""

from __future__ import annotations

import logging
from pathlib import Path

from langchain_openai import ChatOpenAI

from src.core.config import get_settings

logger = logging.getLogger(__name__)


def trigger_improvement_review(
    skill_name: str,
    employee_id: int,
    score: int,
    comment: str,
    conversation_id: int | None,
) -> None:
    """当技能评分低于 3 分时，生成改进建议文件。"""
    if score >= 3 or not comment:
        return

    try:
        settings = get_settings()
        skill_root = Path(settings.skill_path) / str(employee_id) / "skills" / skill_name
        skill_md = skill_root / "SKILL.md"
        if not skill_md.exists():
            logger.warning("skill not found on disk: %s/%s", employee_id, skill_name)
            return

        current_content = skill_md.read_text(encoding="utf-8")

        context = ""
        if conversation_id:
            context = _get_conversation_context(conversation_id)

        llm = _build_llm()
        prompt = (
            f"你是一个技能质量分析师。用户对技能「{skill_name}」的评分为 {score}/5，评价为：「{comment}」。\n\n"
            f"当前技能内容：\n{current_content}\n\n"
            f"对话上下文：\n{context}\n\n"
            f"请分析：\n"
            f"1. 用户不满意的可能原因\n"
            f"2. SKILL.md 可以如何改进（具体的步骤、陷阱补充、措辞调整等）\n"
            f"3. 其他建议\n\n"
            f"输出格式（YAML 风格）：\n"
            f"reason: 原因分析\n"
            f"improvements: 具体的改进方案\n"
            f"suggested_patch: 建议的 SKILL.md 修改（diff 风格，可省略）\n"
        )
        result = llm.invoke(prompt).content.strip()

        suggestion_path = skill_root / "improvement-suggestion.md"
        suggestion_path.write_text(
            f"# 技能改进建议\n\n"
            f"## 评分信息\n"
            f"- 评分: {score}/5\n"
            f"- 用户评价: {comment}\n\n"
            f"## 分析结果\n"
            f"{result}\n\n"
            f"---\n"
            f"自动生成于 {_now_iso()}\n",
            encoding="utf-8",
        )
        logger.info("improvement suggestion written: %s", suggestion_path)

    except Exception as e:
        logger.error("skill improvement review failed: %s", e, exc_info=True)


def _build_llm() -> ChatOpenAI:
    settings = get_settings()
    return ChatOpenAI(
        model=settings.deepagent_model or "qwen2.5-72b-instruct",
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )


def _get_conversation_context(conversation_id: int) -> str:
    from sqlalchemy import select

    from src.db.session import get_session_local
    from src.models.conversation import ConversationMessage

    db = get_session_local()()
    try:
        msgs = db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation_id)
            .order_by(ConversationMessage.id)
            .limit(20)
        ).all()
        lines = []
        for m in msgs:
            role = "用户" if m.role == "user" else "助手"
            content = (m.content or "")[:1000]
            lines.append(f"{role}: {content}")
        return "\n".join(lines)
    finally:
        db.close()


def _now_iso() -> str:
    from datetime import datetime

    return datetime.now().isoformat()

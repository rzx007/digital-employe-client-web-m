"""后执行反思引擎。

对话结束后，自动提取经验写入员工记忆文件 /memories/AGENTS.md。
同步函数，在 _finalize_task_stream 的线程池中调用。
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from langchain_openai import ChatOpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.llm.factory import build_chat_model

logger = logging.getLogger(__name__)

# 内存限流锁：employee_id → 上次反射时间戳
_reflect_locks: dict[int, float] = {}
_REFLECT_COOLDOWN = 60  # 秒


def run_reflection(
    conversation_id: int,
    employee_id: int | None,
    db: Session,
) -> None:
    """对话结束后，提取新经验写入员工记忆文件。"""
    if employee_id is None:
        return

    logger.info(
        "[学习闭环] 开始后执行反思 conversation_id=%s employee_id=%s",
        conversation_id,
        employee_id,
    )

    # 限流：同一员工 60 秒内只反思一次
    if not _acquire_reflect_lock(employee_id):
        return

    # 获取本次对话的 messages
    messages = _get_conversation_messages(db, conversation_id)
    if not messages:
        return

    # 读当前记忆
    memories_path = _resolve_memories_path(employee_id)
    memory_file = memories_path / "AGENTS.md"
    if memory_file.exists():
        from src.service.agent.memory_file import ensure_memory_file_utf8
        from src.service.basic_file_reader import read_text_with_encoding_fallback

        ensure_memory_file_utf8(memory_file)
        current_memory = read_text_with_encoding_fallback(memory_file)
    else:
        current_memory = ""

    # 调用辅助 LLM 提取经验
    llm = _build_llm()
    prompt = (
        "你是一个经验提取助手。分析以下对话，从用户表述中提取：\n"
        "1. 用户的偏好（沟通风格、格式偏好、术语偏好等）\n"
        "2. 环境事实（路径、配置、工具版本等）\n"
        "3. 经验教训（踩了什么坑、什么做法更好）\n"
        "4. 约定（项目惯例、命名规范等）\n\n"
        f"已有的记忆：\n{current_memory}\n\n"
        f"对话内容：\n{messages}\n\n"
        '输出格式：每行一条，以「§」开头。不要重复已有记忆。如果没有新发现，输出「无」。'
    )
    result = llm.invoke(prompt).content.strip()
    if not result or "无" in result[:10]:
        logger.info("reflection conv=%s employee=%s: no new entries found", conversation_id, employee_id)
        return

    # 写入记忆文件（追加新条目到「---」分隔线之前）
    new_entries = result.replace("§ ", "§")
    if not current_memory.endswith("\n"):
        current_memory += "\n"
    lines = current_memory.split("\n")
    insert_before = len(lines)
    for i, line in enumerate(lines):
        if line.strip().startswith("---"):
            insert_before = i
            break
    lines.insert(insert_before, "")
    lines.insert(insert_before, new_entries)
    memory_file.write_text("\n".join(lines), encoding="utf-8")
    logger.info(
        "reflection conv=%s employee=%s: extracted new memory entries",
        conversation_id,
        employee_id,
    )


def _acquire_reflect_lock(employee_id: int) -> bool:
    now = time.time()
    last = _reflect_locks.get(employee_id, 0)
    if now - last < _REFLECT_COOLDOWN:
        return False
    _reflect_locks[employee_id] = now
    return True


def _get_conversation_messages(db: Session, conversation_id: int) -> str:
    from src.models.conversation import ConversationMessage

    msgs = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.id)
        .limit(50)
    ).all()
    if len(msgs) < 3:
        return ""
    lines = []
    for m in msgs:
        role = "用户" if m.role == "user" else "助手"
        content = (m.content or "")[:2000]
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _resolve_memories_path(employee_id: int) -> Path:
    settings = get_settings()
    skill_root = Path(settings.skill_path)
    return skill_root / str(employee_id) / "memories"


def _build_llm() -> ChatOpenAI:
    return build_chat_model(apply_profile=False)

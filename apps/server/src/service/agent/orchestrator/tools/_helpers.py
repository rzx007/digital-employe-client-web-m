"""总管工具间共享的辅助函数与常量。"""

from __future__ import annotations

import json
from typing import Any

from langchain.tools import ToolRuntime

from src.service.agent.orchestrator.runtime import (
    conversation_id_from_runtime,
    get_conversation_id,
)


SKILL_MARKET_URL = "https://skillsmp.com/search"
MARKET_SKILL_SEARCH_LIMIT = 3
MARKET_SKILL_DETAIL_MAX = 3

_market_detail_count_by_conv: dict[int, int] = {}


def resolve_conv_id(runtime: ToolRuntime[None, None] | None) -> int | None:
    return get_conversation_id() or conversation_id_from_runtime(runtime)


def reset_market_detail_count(conversation_id: int | None) -> None:
    if conversation_id is not None:
        _market_detail_count_by_conv[conversation_id] = 0


def take_market_detail_slot(conversation_id: int | None) -> str | None:
    if conversation_id is None:
        return None
    count = _market_detail_count_by_conv.get(conversation_id, 0)
    if count >= MARKET_SKILL_DETAIL_MAX:
        return (
            f"错误：本轮已从 SkillsMP 预览 {MARKET_SKILL_DETAIL_MAX} 个技能（已达上限）。"
            "请从已有结果中选定安装，或重新 search_market_skills 后再预览其他技能。"
        )
    _market_detail_count_by_conv[conversation_id] = count + 1
    return None


def parse_orchestration_task_list(tasks: Any) -> tuple[list[dict] | None, str | None]:
    """将 tasks 参数规范为子任务 dict 列表。支持 JSON 字符串或数组（模型常传 object）。"""
    if isinstance(tasks, list):
        task_list = tasks
    elif isinstance(tasks, str):
        try:
            parsed = json.loads(tasks)
        except json.JSONDecodeError as exc:
            return None, f"错误：tasks 参数格式不是合法的 JSON 数组: {exc}"
        if not isinstance(parsed, list):
            return None, "错误：tasks JSON 必须是数组。"
        task_list = parsed
    else:
        return None, "错误：tasks 必须是 JSON 数组字符串或数组。"

    if len(task_list) == 0:
        return None, "错误：tasks 不能为空，至少需要一个子任务。"

    normalized: list[dict] = []
    for i, item in enumerate(task_list):
        if not isinstance(item, dict):
            return None, f"错误：子任务 #{i} 必须是对象。"
        normalized.append(item)
    return normalized, None

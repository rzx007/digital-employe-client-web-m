"""总管工具间共享的辅助函数与常量。"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain.tools import ToolRuntime


def _loads_lenient(text: str) -> Any | None:
    """宽松解析 LLM 生成的 JSON：先严格 json.loads，失败再修复常见错误重试。

    本地小模型常生成不严格的 JSON（元素间缺逗号、尾逗号、单引号、```json 围栏、
    字符串内裸换行）。直接 json.loads 报错会让组长派活整盘失败。这里尽力修复。
    """
    if not text or not text.strip():
        return None
    # 1) 严格解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    s = text.strip()
    # 2) 去掉 markdown 代码围栏 ```json ... ```
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s).strip()
    # 3) 截取最外层数组/对象（去掉前后多余文字）
    first = min(
        [i for i in (s.find("["), s.find("{")) if i != -1] or [-1]
    )
    last = max(s.rfind("]"), s.rfind("}"))
    if first != -1 and last != -1 and last > first:
        s = s[first : last + 1]

    candidates = [s]
    # 4) 修复：缺逗号 `} {` / `} "` / `] [` → 补逗号
    fixed = re.sub(r"(\}|\]|\"|\d|true|false|null)\s*\n\s*(\{|\[|\")", r"\1,\2", s)
    fixed = re.sub(r"(\})\s*(\{)", r"\1,\2", fixed)
    candidates.append(fixed)
    # 5) 去尾逗号 `,}` `,]`
    no_trailing = re.sub(r",\s*(\}|\])", r"\1", fixed)
    candidates.append(no_trailing)
    # 6) 单引号 → 双引号（仅当没有双引号时，避免破坏正常内容）
    if '"' not in s and "'" in s:
        candidates.append(no_trailing.replace("'", '"'))

    for cand in candidates:
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            continue
    return None

from src.service.agent.orchestrator.runtime import (
    conversation_id_from_runtime,
    get_conversation_id,
)


def _market_web_url() -> str:
    """技能市场页面地址（随 base 配置动态解析），用于提示文案。"""
    try:
        from src.service.skillsmp_service import market_web_url

        return market_web_url()
    except Exception:
        return "https://cn.clawhub-mirror.com/skills"


SKILL_MARKET_URL = _market_web_url()
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
            f"错误：本轮已预览 {MARKET_SKILL_DETAIL_MAX} 个技能（已达上限）。"
            "请从已有结果中选定安装，或重新 search_market_skills 后再预览其他技能。"
        )
    _market_detail_count_by_conv[conversation_id] = count + 1
    return None


def parse_orchestration_task_list(tasks: Any) -> tuple[list[dict] | None, str | None]:
    """将 tasks 参数规范为子任务 dict 列表。支持 JSON 字符串或数组（模型常传 object）。"""
    if isinstance(tasks, list):
        task_list = tasks
    elif isinstance(tasks, str):
        parsed = _loads_lenient(tasks)
        if parsed is None:
            return None, (
                "错误：tasks 参数不是合法的 JSON 数组（已尝试容错修复仍失败）。"
                "请重新输出严格合法的 JSON 数组：元素间用逗号分隔、无尾逗号、"
                "键和字符串用双引号、字符串内的换行写成 \\n。"
            )
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

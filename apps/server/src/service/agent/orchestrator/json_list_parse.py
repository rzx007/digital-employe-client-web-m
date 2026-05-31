from __future__ import annotations

import json
from typing import Any


def parse_json_int_list(
    raw: Any,
    field_name: str,
) -> tuple[list[int] | None, str | None]:
    """解析 tool 参数中的整数 ID 列表。

    兼容 LLM 常见传参：JSON 字符串、Python list、单个整数。
    """
    if raw is None:
        return None, None

    parsed: Any
    if isinstance(raw, list):
        parsed = raw
    elif isinstance(raw, int):
        parsed = [raw]
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return [], None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            return None, f"错误：{field_name} 不是合法的 JSON 数组: {exc}"
        if isinstance(parsed, int):
            parsed = [parsed]
    else:
        return None, f"错误：{field_name} 必须为 JSON 数组。"

    if not isinstance(parsed, list):
        return None, f"错误：{field_name} 必须为 JSON 数组。"

    normalized: list[int] = []
    for i, item in enumerate(parsed):
        try:
            normalized.append(int(item))
        except (TypeError, ValueError):
            return None, f"错误：{field_name}[{i}] 不是有效整数: {item!r}"
    return normalized, None

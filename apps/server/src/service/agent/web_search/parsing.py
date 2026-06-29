from __future__ import annotations

import json


def _extract_text_from_jsonrpc(obj: dict) -> str:
    result = obj.get("result")
    if not isinstance(result, dict):
        return ""
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str) and text:
                return text
    return ""


def parse_exa_sse(raw: str) -> str:
    """从 Exa MCP 响应（SSE 或裸 JSON-RPC）抽出 result.content[0].text。

    解析顺序：先按整体当 JSON-RPC 试；失败再逐行找 `data: {json}` 帧。
    忽略 `[DONE]`、非 JSON 帧、缺字段；找不到返回空串。
    """
    if not raw or not raw.strip():
        return ""
    # 1) 整体直接是 JSON-RPC
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            text = _extract_text_from_jsonrpc(obj)
            if text:
                return text
    except json.JSONDecodeError:
        pass
    # 2) 逐行 SSE：取 data: 后的 JSON 帧
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            text = _extract_text_from_jsonrpc(obj)
            if text:
                return text
    return ""

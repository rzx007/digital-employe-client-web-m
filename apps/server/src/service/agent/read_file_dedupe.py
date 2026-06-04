"""Dedupe repeated read_file tool results in agent message history (Cline-style, minimal step)."""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

logger = logging.getLogger(__name__)

_DEDUPE_PLACEHOLDER_PREFIX = "[此文件后续又读取过"
_READ_FILE_TOOL = "read_file"


def read_file_dedupe_placeholder(path: str) -> str:
    return (
        f"{_DEDUPE_PLACEHOLDER_PREFIX}，此处正文已省略；"
        f"以最后一次 read_file 结果为准。路径: {path}]"
    )


def _is_dedupe_placeholder(content: str) -> bool:
    return content.strip().startswith(_DEDUPE_PLACEHOLDER_PREFIX)


def _tool_call_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def extract_read_file_path(
    message: ToolMessage,
    messages: list[BaseMessage],
    index: int,
) -> str | None:
    """Resolve virtual path for a read_file ToolMessage."""
    extra = message.additional_kwargs or {}
    path = str(extra.get("read_file_path") or "").strip()
    if path:
        return path

    tool_call_id = message.tool_call_id
    if not tool_call_id:
        return None

    for j in range(index - 1, -1, -1):
        candidate = messages[j]
        if not isinstance(candidate, AIMessage):
            continue
        for tool_call in candidate.tool_calls or []:
            if not isinstance(tool_call, dict):
                continue
            if tool_call.get("id") != tool_call_id:
                continue
            if tool_call.get("name") != _READ_FILE_TOOL:
                continue
            args = _tool_call_args(tool_call.get("args"))
            file_path = args.get("file_path") or args.get("path")
            if file_path:
                return str(file_path).strip()
    return None


def extract_read_file_offset(
    message: ToolMessage,
    messages: list[BaseMessage],
    index: int,
) -> int:
    """0-indexed line offset of a read_file ToolMessage."""
    extra = message.additional_kwargs or {}
    raw = extra.get("read_file_offset")
    if raw is not None:
        try:
            return max(0, int(raw))
        except (TypeError, ValueError):
            pass

    tool_call_id = message.tool_call_id
    if not tool_call_id:
        return 0

    for j in range(index - 1, -1, -1):
        candidate = messages[j]
        if not isinstance(candidate, AIMessage):
            continue
        for tool_call in candidate.tool_calls or []:
            if not isinstance(tool_call, dict):
                continue
            if tool_call.get("id") != tool_call_id:
                continue
            if tool_call.get("name") != _READ_FILE_TOOL:
                continue
            args = _tool_call_args(tool_call.get("args"))
            try:
                return max(0, int(args.get("offset") or 0))
            except (TypeError, ValueError):
                return 0
    return 0


def read_file_dedupe_key(
    message: ToolMessage,
    messages: list[BaseMessage],
    index: int,
) -> tuple[str, int] | None:
    path = extract_read_file_path(message, messages, index)
    if not path:
        return None
    return (path, extract_read_file_offset(message, messages, index))


def is_read_file_dedupe_placeholder(content: str) -> bool:
    return _is_dedupe_placeholder(content)


def _is_success_read_file(message: ToolMessage) -> bool:
    return is_success_read_file_tool(message)


def is_success_read_file_tool(message: ToolMessage) -> bool:
    if message.name != _READ_FILE_TOOL:
        return False
    status = getattr(message, "status", None) or "success"
    if status == "error":
        return False
    content = message.text if hasattr(message, "text") else str(message.content or "")
    if content.strip().startswith("Error:"):
        return False
    return True


def dedupe_read_file_tool_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Keep only the latest successful read_file body per (path, offset); earlier dupes → placeholder."""
    last_index_by_key: dict[tuple[str, int], int] = {}
    for index, message in enumerate(messages):
        if not isinstance(message, ToolMessage) or not _is_success_read_file(message):
            continue
        key = read_file_dedupe_key(message, messages, index)
        if key:
            last_index_by_key[key] = index

    if not last_index_by_key:
        return messages

    duplicate_indices = {
        index
        for key, last_index in last_index_by_key.items()
        for index, message in enumerate(messages)
        if index != last_index
        and isinstance(message, ToolMessage)
        and _is_success_read_file(message)
        and read_file_dedupe_key(message, messages, index) == key
    }
    if not duplicate_indices:
        return messages

    out: list[BaseMessage] = []
    replaced = 0
    for index, message in enumerate(messages):
        if index not in duplicate_indices or not isinstance(message, ToolMessage):
            out.append(message)
            continue
        path = extract_read_file_path(message, messages, index) or "unknown"
        current = str(message.content or "")
        if _is_dedupe_placeholder(current):
            out.append(message)
            continue
        out.append(
            message.model_copy(
                update={
                    "content": read_file_dedupe_placeholder(path),
                    "content_blocks": [],
                }
            )
        )
        replaced += 1

    if replaced:
        logger.info(
            "read_file dedupe: replaced %d earlier duplicate read(s), kept %d path(s)",
            replaced,
            len(last_index_by_key),
        )
    return out


# 同一文件被读取超过此次数，判定为“反复读取同一文件”的失控行为，注入强指令
# 让模型停止读取、直接基于已有内容继续。本地小模型常有此顽固习惯，dedupe 只
# 省 token 不阻止它继续读，递归上限要 60 步才截断（已几分钟）；这里在它读到
# 第 N 次时就主动叫停，从根上掐断“读十几遍同一文件”的循环。
_EXCESSIVE_READ_THRESHOLD = 3


def inject_excessive_read_stop_hint(
    messages: list[BaseMessage],
) -> list[BaseMessage]:
    """若同一文件反复 read（尤其重复 offset / 读回已覆盖区间），注入强提示。"""
    reads_by_path: dict[str, list[int]] = {}
    for index, message in enumerate(messages):
        if not isinstance(message, ToolMessage) or not is_success_read_file_tool(
            message
        ):
            continue
        path = extract_read_file_path(message, messages, index)
        if not path:
            continue
        off = extract_read_file_offset(message, messages, index)
        reads_by_path.setdefault(path, []).append(off)

    over: dict[str, list[int]] = {}
    for path, offsets in reads_by_path.items():
        if len(offsets) < _EXCESSIVE_READ_THRESHOLD:
            continue
        # 分页前进（0→200→400）允许；重复 offset 或读回更小 offset 视为失控
        max_so_far = -1
        regressive = False
        dup_offsets = len(offsets) != len(set(offsets))
        for off in offsets:
            if off < max_so_far:
                regressive = True
            max_so_far = max(max_so_far, off)
        if dup_offsets or regressive or len(offsets) >= _EXCESSIVE_READ_THRESHOLD + 1:
            over[path] = offsets

    if not over:
        return messages

    marker = "⚠️[系统提醒·停止重复读取]"
    parts = []
    for path, offsets in over.items():
        max_off = max(offsets) if offsets else 0
        parts.append(
            f"{path}（已读 offset 序列: {offsets}，最大 offset={max_off}）"
        )
    paths_text = "；".join(parts)
    hint = (
        f"\n\n{marker} 你在同一文件上反复/倒退读取（{paths_text}）。"
        "请停止 read_file，直接基于**已读过的所有片段**完成任务；"
        "若确需续读，只能 offset 大于当前最大已读行号，禁止 offset=0 重读开头。"
    )

    # 安全注入：把提示追加到“最后一条成功 read 结果”的内容末尾，而不是新增
    # 孤立 ToolMessage（孤立 tool 消息会破坏 OpenAI 消息结构）。
    last_read_idx = -1
    for index, message in enumerate(messages):
        if isinstance(message, ToolMessage) and is_success_read_file_tool(message):
            last_read_idx = index
    if last_read_idx < 0:
        return messages

    target = messages[last_read_idx]
    current = str(target.content or "")
    if marker in current:
        return messages  # 已注入过，避免重复

    out = list(messages)
    out[last_read_idx] = target.model_copy(
        update={"content": current + hint}
    )
    logger.warning(
        "excessive read_file detected (%s) → 注入停止指令", over,
    )
    return out

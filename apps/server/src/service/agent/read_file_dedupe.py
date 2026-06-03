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
    """Keep only the latest successful read_file body per path; earlier ones → placeholder."""
    last_index_by_path: dict[str, int] = {}
    for index, message in enumerate(messages):
        if not isinstance(message, ToolMessage) or not _is_success_read_file(message):
            continue
        path = extract_read_file_path(message, messages, index)
        if path:
            last_index_by_path[path] = index

    if not last_index_by_path:
        return messages

    duplicate_indices = {
        index
        for path, last_index in last_index_by_path.items()
        for index, message in enumerate(messages)
        if index != last_index
        and isinstance(message, ToolMessage)
        and _is_success_read_file(message)
        and extract_read_file_path(message, messages, index) == path
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
            len(last_index_by_path),
        )
    return out

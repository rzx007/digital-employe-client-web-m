"""Replace large historical read_file bodies with path-only stubs (§C / #8 advanced).

Reversible: files remain on disk; the model can call read_file again when needed.
UI tool cards are unchanged — compression applies only before LLM calls.
"""

from __future__ import annotations

import logging

from langchain_core.messages import BaseMessage, ToolMessage

from src.service.agent.read_file_dedupe import (
    extract_read_file_offset,
    extract_read_file_path,
    is_read_file_dedupe_placeholder,
    is_success_read_file_tool,
)

logger = logging.getLogger(__name__)

_PATH_ONLY_PREFIX = "[大文件正文已省略"
_DEFAULT_MIN_CHARS = 4000
_DEFAULT_KEEP_RECENT = 1


def read_file_path_only_placeholder(path: str) -> str:
    return (
        f"{_PATH_ONLY_PREFIX}以节省上下文。需要时请 read_file 重新读取。路径: {path}]"
    )


def is_path_only_placeholder(content: str) -> bool:
    return content.strip().startswith(_PATH_ONLY_PREFIX)


def _message_body_length(message: ToolMessage) -> int:
    text = message.text if hasattr(message, "text") else str(message.content or "")
    length = len(text.strip())
    if length:
        return length
    blocks = message.content_blocks or []
    return sum(len(str(b.get("base64") or b.get("data") or "")) for b in blocks)


def compress_large_read_file_history(
    messages: list[BaseMessage],
    *,
    min_chars: int = _DEFAULT_MIN_CHARS,
    keep_recent_count: int = _DEFAULT_KEEP_RECENT,
) -> list[BaseMessage]:
    """Keep the newest read_file result(s) intact; older large bodies → path stub."""
    read_indices = [
        index
        for index, message in enumerate(messages)
        if isinstance(message, ToolMessage) and is_success_read_file_tool(message)
    ]
    if not read_indices:
        return messages

    # 同一文件正在分页阅读（多个 offset）时，保留全部片段，避免模型“忘记读到哪里”
    offsets_by_path: dict[str, set[int]] = {}
    for index in read_indices:
        message = messages[index]
        if not isinstance(message, ToolMessage):
            continue
        path = extract_read_file_path(message, messages, index)
        if not path:
            continue
        offsets_by_path.setdefault(path, set()).add(
            extract_read_file_offset(message, messages, index)
        )
    paginated_paths = {p for p, offs in offsets_by_path.items() if len(offs) > 1}

    keep_indices = set(read_indices[-keep_recent_count:])

    to_compress: set[int] = set()
    for index in read_indices:
        if index in keep_indices:
            continue
        message = messages[index]
        if not isinstance(message, ToolMessage):
            continue
        path = extract_read_file_path(message, messages, index)
        if path and path in paginated_paths:
            continue
        content = str(message.content or "")
        if is_read_file_dedupe_placeholder(content) or is_path_only_placeholder(content):
            continue
        if _message_body_length(message) < min_chars:
            continue
        to_compress.add(index)

    if not to_compress:
        return messages

    out: list[BaseMessage] = []
    compressed = 0
    for index, message in enumerate(messages):
        if index not in to_compress or not isinstance(message, ToolMessage):
            out.append(message)
            continue
        path = extract_read_file_path(message, messages, index) or "unknown"
        out.append(
            message.model_copy(
                update={
                    "content": read_file_path_only_placeholder(path),
                    "content_blocks": [],
                }
            )
        )
        compressed += 1

    logger.info(
        "read_file path-only: compressed %d large historical read(s), kept %d recent",
        compressed,
        len(keep_indices),
    )
    return out

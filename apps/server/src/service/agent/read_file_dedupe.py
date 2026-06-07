"""Dedupe repeated read_file tool results in agent message history (Cline-style, minimal step)."""

from __future__ import annotations

import json
import logging
import re
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


# 反复「改脚本→跑→报错→再改」循环的阈值。本地模型写 Python 生成 docx/pptx 时
# 常陷入此循环（每次 edit 改一点、shell 跑、报错、再 edit），不收敛直到被递归
# 上限截断（曾观测 edit_file 同一脚本 9 次、耗时 5+ 分钟）。
# # 阈值设 5（不是 3）：正常写代码会合理地多次编辑同一文件逐步完善（如前端写
# index.html 改几版），只拦真正失控的反复修改，避免误伤正常迭代。
_EXCESSIVE_EDIT_THRESHOLD = 5
_EDIT_RUN_TOOLS = ("edit_file", "write_file", "shell_execute", "execute")


def inject_excessive_edit_run_stop_hint(
    messages: list[BaseMessage],
) -> list[BaseMessage]:
    """若反复 edit / 重跑同一脚本超过阈值，注入「停止反复修改、换思路」强提示。"""
    # 统计每个文件被 edit_file/write_file 的次数 + shell 调用总次数
    edit_counts: dict[str, int] = {}
    shell_runs = 0
    for message in messages:
        if not isinstance(message, AIMessage):
            continue
        for tc in (message.tool_calls or []):
            if not isinstance(tc, dict):
                continue
            name = tc.get("name")
            if name not in _EDIT_RUN_TOOLS:
                continue
            args = _tool_call_args(tc.get("args"))
            if name in ("edit_file", "write_file"):
                fp = args.get("file_path") or args.get("path")
                if fp:
                    edit_counts[str(fp)] = edit_counts.get(str(fp), 0) + 1
            else:  # shell_execute / execute
                shell_runs += 1

    over_edits = {p: c for p, c in edit_counts.items() if c >= _EXCESSIVE_EDIT_THRESHOLD}
    # 反复改脚本 或 反复跑命令，任一超阈值都叫停
    if not over_edits and shell_runs < _EXCESSIVE_EDIT_THRESHOLD + 2:
        return messages

    marker = "⚠️[系统提醒·停止反复改脚本]"
    # 找最后一条 tool 结果追加提示（保持消息结构合法）
    last_tool_idx = -1
    for index, message in enumerate(messages):
        if isinstance(message, ToolMessage):
            last_tool_idx = index
    if last_tool_idx < 0:
        return messages
    target = messages[last_tool_idx]
    current = str(target.content or "")
    if marker in current:
        return messages

    detail = ""
    if over_edits:
        detail = "、".join(f"{p}（已改 {c} 次）" for p, c in over_edits.items())
    hint = (
        f"\n\n{marker} 你在反复修改/重跑脚本却不收敛"
        + (f"：{detail}。" if detail else f"（已执行命令 {shell_runs} 次）。")
        + "请停止这种「改一点→跑→报错→再改」的循环，换个思路："
        "① 一次性把脚本写完整、写正确再跑；② 若某库不可用或反复报同样的错，"
        "改用更简单可靠的方式（如直接用 docx/pptx 技能而非手写脚本）；"
        "③ 不要再对同一文件做零碎的小修改。"
    )
    out = list(messages)
    out[last_tool_idx] = target.model_copy(update={"content": current + hint})
    logger.warning(
        "excessive edit/run loop detected (edits=%s, shell_runs=%d) → 注入停止指令",
        over_edits, shell_runs,
    )
    return out


_WRITE_ALREADY_EXISTS_MARKER = "⚠️[系统提醒·文件已存在勿 write_file]"
_WRITE_ALREADY_EXISTS_RE = re.compile(
    r"Cannot write to\s+(\S+)\s+because it already exists",
    re.IGNORECASE,
)


def is_write_already_exists_error(content: str) -> bool:
    text = (content or "").lower()
    return "already exists" in text and "cannot write" in text


def extract_path_from_write_exists_error(content: str) -> str | None:
    m = _WRITE_ALREADY_EXISTS_RE.search(content or "")
    return m.group(1) if m else None


def inject_write_already_exists_hint(
    messages: list[BaseMessage],
) -> list[BaseMessage]:
    """write_file 报 already exists 时注入强提示：改用 edit_file，勿再 write 同名路径。"""
    out = list(messages)
    changed = False
    for index, message in enumerate(out):
        if not isinstance(message, ToolMessage):
            continue
        content = str(message.content or "")
        if not is_write_already_exists_error(content):
            continue
        if _WRITE_ALREADY_EXISTS_MARKER in content:
            continue
        path = extract_path_from_write_exists_error(content) or "该文件"
        hint = (
            f"\n\n{_WRITE_ALREADY_EXISTS_MARKER} 路径 {path} 已存在，"
            "**禁止再次 write_file 同一路径**（系统不会覆盖，也勿删文件或换名）。"
            "若刚 read_file 过：请立刻改用 **edit_file**，"
            "`old_string` = 读到的**完整原文**，`new_string` = 重写后的**完整新内容**（整文件替换也填全文）。"
            "改完再 shell_execute 运行；**不要**再试 write_file。"
        )
        out[index] = message.model_copy(update={"content": content + hint})
        changed = True
        logger.warning(
            "write_file already exists on %s → 注入 edit_file 指引", path
        )
    return out if changed else messages
